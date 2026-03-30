using System.Buffers;
using GitHubJwt;
using Microsoft.Extensions.Options;
using Octokit;

namespace PreviewHost.Previews;

internal sealed class GitHubArtifactClient(IOptions<PreviewHostOptions> options, ILogger<GitHubArtifactClient> logger)
{
    private static readonly ApiOptions SinglePageApiOptions = new()
    {
        StartPage = 1,
        PageCount = 1,
        PageSize = 100
    };

    private static readonly TimeSpan DownloadProgressPublishInterval = TimeSpan.FromSeconds(1);
    private const string CiWorkflowPath = ".github/workflows/ci.yml";
    private const string DefaultPreviewArtifactName = "frontend-dist";
    private readonly SemaphoreSlim _installationTokenGate = new(1, 1);
    private readonly SemaphoreSlim _pullRequestCatalogGate = new(1, 1);
    private readonly PreviewHostOptions _options = options.Value;
    private readonly ILogger<GitHubArtifactClient> _logger = logger;
    private AccessToken? _cachedInstallationToken;
    private long? _cachedInstallationId;
    private IReadOnlyList<GitHubPullRequestSummary>? _cachedOpenPullRequests;
    private DateTimeOffset _cachedOpenPullRequestsExpiresAtUtc;

    public async Task<PreviewRegistrationRequest?> TryResolveLatestPreviewRegistrationAsync(int pullRequestNumber, CancellationToken cancellationToken)
    {
        EnsureCredentialsConfigured();
        EnsureRepositoryConfigured();

        var repositoryClient = await CreateRepositoryClientAsync(
            _options.RepositoryOwner,
            _options.RepositoryName,
            cancellationToken);

        PullRequest? pullRequest;
        try
        {
            pullRequest = await repositoryClient.PullRequest.Get(
                _options.RepositoryOwner,
                _options.RepositoryName,
                pullRequestNumber);
        }
        catch (NotFoundException)
        {
            return null;
        }

        if (pullRequest is null || string.IsNullOrWhiteSpace(pullRequest.Head?.Sha))
        {
            return null;
        }

        var workflowRun = await GetLatestSuccessfulPreviewRunAsync(
            repositoryClient,
            _options.RepositoryOwner,
            _options.RepositoryName,
            pullRequest.Head.Sha,
            cancellationToken);

        if (workflowRun is null)
        {
            return null;
        }

        var artifacts = await GetArtifactsAsync(
            repositoryClient,
            _options.RepositoryOwner,
            _options.RepositoryName,
            workflowRun.Id,
            cancellationToken);

        var previewArtifact = ResolvePreviewArtifact(artifacts.Artifacts, pullRequestNumber);
        if (previewArtifact is null)
        {
            return null;
        }

        return new PreviewRegistrationRequest
        {
            RepositoryOwner = _options.RepositoryOwner,
            RepositoryName = _options.RepositoryName,
            PullRequestNumber = pullRequestNumber,
            HeadSha = pullRequest.Head.Sha,
            RunId = workflowRun.Id,
            RunAttempt = checked((int)workflowRun.RunAttempt),
            ArtifactName = previewArtifact.Name,
            CompletedAtUtc = workflowRun.UpdatedAt
        };
    }

    public async Task<IReadOnlyList<GitHubPullRequestSummary>> ListOpenPullRequestsAsync(CancellationToken cancellationToken)
    {
        EnsureCredentialsConfigured();
        EnsureRepositoryConfigured();

        await _pullRequestCatalogGate.WaitAsync(cancellationToken);
        try
        {
            if (_cachedOpenPullRequests is not null
                && _cachedOpenPullRequestsExpiresAtUtc > DateTimeOffset.UtcNow)
            {
                return _cachedOpenPullRequests;
            }

            var repositoryClient = await CreateRepositoryClientAsync(
                _options.RepositoryOwner,
                _options.RepositoryName,
                cancellationToken);

            var request = new PullRequestRequest
            {
                State = ItemStateFilter.Open,
                SortProperty = PullRequestSort.Created,
                SortDirection = SortDirection.Descending
            };

            var pullRequests = new List<PullRequest>();

            for (var page = 1; ; page++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var pageItems = await repositoryClient.PullRequest.GetAllForRepository(
                    _options.RepositoryOwner,
                    _options.RepositoryName,
                    request,
                    new ApiOptions
                    {
                        StartPage = page,
                        PageCount = 1,
                        PageSize = 100
                    });

                if (pageItems.Count == 0)
                {
                    break;
                }

                pullRequests.AddRange(pageItems);

                if (pageItems.Count < 100)
                {
                    break;
                }
            }

            _cachedOpenPullRequests = [.. pullRequests
                .OrderByDescending(static pullRequest => pullRequest.CreatedAt)
                .ThenByDescending(static pullRequest => pullRequest.Number)
                .Select(static pullRequest => new GitHubPullRequestSummary(
                    pullRequest.Number,
                    pullRequest.Title,
                    pullRequest.HtmlUrl,
                    pullRequest.Head?.Sha ?? string.Empty,
                    pullRequest.User?.Login,
                    pullRequest.Draft,
                    pullRequest.CreatedAt,
                    pullRequest.UpdatedAt))];

            _cachedOpenPullRequestsExpiresAtUtc = DateTimeOffset.UtcNow.AddSeconds(15);
            return _cachedOpenPullRequests;
        }
        finally
        {
            _pullRequestCatalogGate.Release();
        }
    }

    public async Task<GitHubArtifactDescriptor> GetArtifactDescriptorAsync(PreviewWorkItem workItem, CancellationToken cancellationToken)
    {
        EnsureCredentialsConfigured();

        var repositoryClient = await CreateRepositoryClientAsync(
            workItem.RepositoryOwner,
            workItem.RepositoryName,
            cancellationToken);

        var payload = await GetArtifactsAsync(
            repositoryClient,
            workItem.RepositoryOwner,
            workItem.RepositoryName,
            workItem.RunId,
            cancellationToken);

        var artifact = payload.Artifacts.FirstOrDefault(candidate =>
            !candidate.Expired
            && string.Equals(candidate.Name, workItem.ArtifactName, StringComparison.Ordinal));

        if (artifact is null)
        {
            throw new InvalidOperationException(
                $"Could not find a non-expired GitHub Actions artifact named '{workItem.ArtifactName}' on run {workItem.RunId}.");
        }

        return new GitHubArtifactDescriptor(
            workItem.RepositoryOwner,
            workItem.RepositoryName,
            artifact.Id,
            artifact.Name,
            artifact.ExpiresAt == default ? DateTimeOffset.UtcNow : new DateTimeOffset(artifact.ExpiresAt, TimeSpan.Zero),
            artifact.SizeInBytes > 0 ? artifact.SizeInBytes : null);
    }

    public async Task DownloadArtifactAsync(
        GitHubArtifactDescriptor artifact,
        string destinationZipPath,
        Func<PreviewDownloadProgress, CancellationToken, ValueTask> progressCallback,
        CancellationToken cancellationToken)
    {
        EnsureCredentialsConfigured();
        Directory.CreateDirectory(Path.GetDirectoryName(destinationZipPath)!);
        var bufferSettings = PreviewBufferSettings.Resolve();

        var repositoryClient = await CreateRepositoryClientAsync(
            artifact.RepositoryOwner,
            artifact.RepositoryName,
            cancellationToken);

        await using var sourceStream = await repositoryClient.Actions.Artifacts.DownloadArtifact(
            artifact.RepositoryOwner,
            artifact.RepositoryName,
            artifact.ArtifactId,
            "zip");

        var totalBytes = artifact.SizeInBytes;
        if (totalBytes is null && sourceStream.CanSeek)
        {
            totalBytes = sourceStream.Length;
        }

        await using var destinationStream = new FileStream(
            destinationZipPath,
            System.IO.FileMode.Create,
            System.IO.FileAccess.Write,
            System.IO.FileShare.None,
            bufferSize: bufferSettings.DownloadFileBufferSize,
            options: System.IO.FileOptions.Asynchronous);

        _logger.LogInformation(
            "Downloading preview artifact {ArtifactName} with adaptive buffers: copy {CopyBufferSizeMiB} MiB, file {FileBufferSizeMiB} MiB (~{AvailableMemoryMiB} MiB headroom)",
            artifact.ArtifactName,
            bufferSettings.DownloadCopyBufferMiB,
            bufferSettings.DownloadFileBufferMiB,
            bufferSettings.AvailableMemoryMiB);

        await using var progressPublisher = new DownloadProgressPublisher(
            totalBytes, 
            progressCallback, 
            cancellationToken);

        var buffer = ArrayPool<byte>.Shared.Rent(bufferSettings.DownloadCopyBufferSize);
        long downloadedBytes = 0;

        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var read = await sourceStream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                if (read == 0)
                {
                    break;
                }

                await destinationStream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                downloadedBytes += read;
                progressPublisher.Report(downloadedBytes);
            }

            await destinationStream.FlushAsync(cancellationToken);
            await progressPublisher.CompleteAsync(downloadedBytes);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static async Task<ListArtifactsResponse> GetArtifactsAsync(
        GitHubClient repositoryClient,
        string repositoryOwner,
        string repositoryName,
        long runId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        return await repositoryClient.Actions.Artifacts.ListWorkflowArtifacts(
            repositoryOwner,
            repositoryName,
            runId,
            new ListArtifactsRequest
            {
                Page = 1,
                PerPage = 100
            });
    }

    private static async Task<WorkflowRun?> GetLatestSuccessfulPreviewRunAsync(
        GitHubClient repositoryClient,
        string repositoryOwner,
        string repositoryName,
        string headSha,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var request = new WorkflowRunsRequest
        {
            Event = "pull_request",
            HeadSha = headSha,
            Status = CheckRunStatusFilter.Completed
        };

        var payload = await repositoryClient.Actions.Workflows.Runs.List(
            repositoryOwner,
            repositoryName,
            request,
            SinglePageApiOptions);

        return payload.WorkflowRuns
            .Where(static run => string.Equals(run.Conclusion?.StringValue, "success", StringComparison.OrdinalIgnoreCase))
            .Where(run =>
                string.Equals(run.Path, CiWorkflowPath, StringComparison.Ordinal)
                || string.Equals(run.Name, "CI", StringComparison.Ordinal))
            .OrderByDescending(static run => run.RunAttempt)
            .ThenByDescending(static run => run.UpdatedAt)
            .ThenByDescending(static run => run.Id)
            .FirstOrDefault();
    }

    private async Task<GitHubClient> CreateRepositoryClientAsync(
        string repositoryOwner,
        string repositoryName,
        CancellationToken cancellationToken)
    {
        if (_options.HasGitHubToken)
        {
            return CreateClient(new Credentials(_options.GitHubToken));
        }

        var installationToken = await GetInstallationTokenAsync(repositoryOwner, repositoryName, cancellationToken);
        return CreateClient(new Credentials(installationToken.Token));
    }

    private async Task<AccessToken> GetInstallationTokenAsync(
        string repositoryOwner,
        string repositoryName,
        CancellationToken cancellationToken)
    {
        EnsureGitHubAppConfigured();

        await _installationTokenGate.WaitAsync(cancellationToken);
        try
        {
            if (_cachedInstallationToken is not null
                && _cachedInstallationToken.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
            {
                return _cachedInstallationToken;
            }

            var appClient = CreateGitHubAppClient();
            var installationId = _options.GitHubAppInstallationId > 0
                ? _options.GitHubAppInstallationId
                : _cachedInstallationId.GetValueOrDefault();

            if (installationId <= 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                installationId = (await appClient.GitHubApps.GetRepositoryInstallationForCurrent(
                    repositoryOwner,
                    repositoryName)).Id;
            }

            _cachedInstallationId = installationId;
            cancellationToken.ThrowIfCancellationRequested();
            _cachedInstallationToken = await appClient.GitHubApps.CreateInstallationToken(installationId);
            return _cachedInstallationToken;
        }
        finally
        {
            _installationTokenGate.Release();
        }
    }

    private GitHubClient CreateGitHubAppClient()
    {
        EnsureGitHubAppConfigured();

        var jwtFactory = new GitHubJwtFactory(
            new StringPrivateKeySource(NormalizePrivateKey(_options.GitHubAppPrivateKey)),
            new GitHubJwtFactoryOptions
            {
                AppIntegrationId = _options.GitHubAppId,
                ExpirationSeconds = 540
            });

        var jwt = jwtFactory.CreateEncodedJwtToken(TimeSpan.FromMinutes(9));
        return CreateClient(new Credentials(jwt, AuthenticationType.Bearer));
    }

    private GitHubClient CreateClient(Credentials credentials)
    {
        var client = new GitHubClient(
            new ProductHeaderValue("aspire-dev-preview-host"),
            new Uri(_options.GitHubApiBaseUrl))
        {
            Credentials = credentials
        };

        return client;
    }

    private void EnsureCredentialsConfigured()
    {
        if (_options.HasGitHubToken)
        {
            return;
        }

        EnsureGitHubAppConfigured();
    }

    private void EnsureGitHubAppConfigured()
    {
        if (!_options.HasGitHubAppConfiguration)
        {
            throw new InvalidOperationException(
                $"Either '{PreviewHostOptions.SectionName}:GitHubToken' or both '{PreviewHostOptions.SectionName}:GitHubAppId' and '{PreviewHostOptions.SectionName}:GitHubAppPrivateKey' must be configured before GitHub authentication can be used.");
        }
    }

    private void EnsureRepositoryConfigured()
    {
        if (string.IsNullOrWhiteSpace(_options.RepositoryOwner) || string.IsNullOrWhiteSpace(_options.RepositoryName))
        {
            throw new InvalidOperationException(
                $"The '{PreviewHostOptions.SectionName}:RepositoryOwner' and '{PreviewHostOptions.SectionName}:RepositoryName' settings must be configured before previews can be discovered.");
        }
    }

    private static Artifact? ResolvePreviewArtifact(IEnumerable<Artifact> artifacts, int pullRequestNumber)
    {
        var preferredNames = new[]
        {
            $"frontend-dist-pr-{pullRequestNumber}",
            DefaultPreviewArtifactName
        };

        foreach (var artifactName in preferredNames)
        {
            var artifact = artifacts.FirstOrDefault(candidate =>
                !candidate.Expired
                && string.Equals(candidate.Name, artifactName, StringComparison.Ordinal));

            if (artifact is not null)
            {
                return artifact;
            }
        }

        return null;
    }

    private sealed class DownloadProgressPublisher : IAsyncDisposable
    {
        private readonly Func<PreviewDownloadProgress, CancellationToken, ValueTask> _progressCallback;
        private readonly CancellationTokenSource _publisherCancellationSource;
        private readonly SemaphoreSlim _publishGate = new(1, 1);
        private readonly Task _publisherTask;
        private readonly long? _totalBytes;
        private long _latestBytes;
        private long _publishedBytes = -1;
        private int _completed;

        public DownloadProgressPublisher(
            long? totalBytes,
            Func<PreviewDownloadProgress, CancellationToken, ValueTask> progressCallback,
            CancellationToken cancellationToken)
        {
            _totalBytes = totalBytes;
            _progressCallback = progressCallback;
            _publisherCancellationSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _publisherTask = Task.Run(() => PublishLoopAsync(_publisherCancellationSource.Token), CancellationToken.None);
        }

        public void Report(long downloadedBytes) => Interlocked.Exchange(ref _latestBytes, downloadedBytes);

        public async Task CompleteAsync(long downloadedBytes)
        {
            Report(downloadedBytes);

            if (Interlocked.Exchange(ref _completed, 1) != 0)
            {
                return;
            }

            await PublishLatestAsync(CancellationToken.None);
            await StopAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await StopAsync();
            _publishGate.Dispose();
            _publisherCancellationSource.Dispose();
        }

        private async Task PublishLoopAsync(CancellationToken cancellationToken)
        {
            using var timer = new PeriodicTimer(DownloadProgressPublishInterval);

            try
            {
                while (await timer.WaitForNextTickAsync(cancellationToken))
                {
                    await PublishLatestAsync(cancellationToken);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
        }

        private async Task PublishLatestAsync(CancellationToken cancellationToken)
        {
            await _publishGate.WaitAsync(cancellationToken);
            try
            {
                var latestBytes = Interlocked.Read(ref _latestBytes);
                if (latestBytes == _publishedBytes)
                {
                    return;
                }

                await _progressCallback(new PreviewDownloadProgress(latestBytes, _totalBytes), cancellationToken);
                _publishedBytes = latestBytes;
            }
            finally
            {
                _publishGate.Release();
            }
        }

        private async Task StopAsync()
        {
            _publisherCancellationSource.Cancel();

            try
            {
                await _publisherTask;
            }
            catch (OperationCanceledException) when (_publisherCancellationSource.IsCancellationRequested)
            {
            }
        }
    }

    private static string NormalizePrivateKey(string privateKey)
    {
        var normalized = privateKey.Trim();
        normalized = normalized.Replace("\\r\\n", "\n", StringComparison.Ordinal);
        normalized = normalized.Replace("\\n", "\n", StringComparison.Ordinal);
        return normalized.Replace("\r\n", "\n", StringComparison.Ordinal);
    }
}
