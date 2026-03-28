var builder = DistributedApplication.CreateBuilder(args);

var githubToken = builder.AddParameter("github-token", secret: true);
var githubAppId = builder.AddParameter("github-app-id");
var githubAppInstallationId = builder.AddParameter("github-app-installation-id");
var githubAppPrivateKey = builder.AddParameter("github-app-private-key", secret: true);
var registrationToken = builder.AddParameter("registration-token", secret: true);

builder.AddProject<Projects.PreviewHost>("previewhost")
    .WithExternalHttpEndpoints()
    .WithEnvironment("PreviewHost__GitHubToken", githubToken)
    .WithEnvironment("PreviewHost__GitHubAppId", githubAppId)
    .WithEnvironment("PreviewHost__GitHubAppInstallationId", githubAppInstallationId)
    .WithEnvironment("PreviewHost__GitHubAppPrivateKey", githubAppPrivateKey)
    .WithEnvironment("PreviewHost__RegistrationToken", registrationToken);

if (!builder.ExecutionContext.IsRunMode)
{
    builder.AddAzureAppServiceEnvironment("preview");
}

builder.Build().Run();
