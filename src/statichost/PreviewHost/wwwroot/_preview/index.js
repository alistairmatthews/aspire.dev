const previewGrid = document.getElementById("preview-grid");
const windowCapacity = document.getElementById("window-capacity");
const windowCount = document.getElementById("window-count");
const authorFilter = document.getElementById("author-filter");

const numberFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

let catalogEntries = [];
let selectedAuthor = "";
let activePreviewCount = 0;
let maxActivePreviews = 0;
let openPullRequestCount = 0;

authorFilter.addEventListener("change", () => {
  selectedAuthor = authorFilter.value;
  renderCatalog();
});

loadCatalog().catch((error) => {
  renderEmptyState(error instanceof Error ? error.message : "The preview host could not load open pull requests.");
});

setInterval(() => {
  loadCatalog().catch((error) => {
    console.error(error);
  });
}, 15000);

async function loadCatalog() {
  const response = await fetch("/api/previews/catalog", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Open pull requests request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  catalogEntries = Array.isArray(payload.entries) ? payload.entries : [];
  maxActivePreviews = payload.maxActivePreviews ?? 0;
  activePreviewCount = payload.activePreviewCount ?? 0;
  openPullRequestCount = payload.openPullRequestCount ?? catalogEntries.length;

  syncAuthorFilter(catalogEntries);
  renderCatalog();
}

function renderCatalog() {
  const filteredEntries = applyAuthorFilter(catalogEntries);

  windowCapacity.textContent = `Warm window: ${numberFormatter.format(activePreviewCount)} / ${numberFormatter.format(maxActivePreviews)}`;
  windowCount.textContent = selectedAuthor
    ? `Showing ${numberFormatter.format(filteredEntries.length)} of ${numberFormatter.format(openPullRequestCount)} open PRs`
    : `Open PRs: ${numberFormatter.format(openPullRequestCount)}`;

  if (filteredEntries.length === 0) {
    renderEmptyState(selectedAuthor
      ? `No open pull requests match ${getSelectedAuthorLabel()}.`
      : "No open pull requests need previews right now.");
    return;
  }

  previewGrid.innerHTML = filteredEntries.map(renderPreviewCard).join("\n");
}

function renderPreviewCard(entry) {
  const preview = entry.preview ?? null;
  const previewPath = escapeHtml(entry.previewPath ?? "/prs/");
  const title = escapeHtml(entry.title ?? `PR #${entry.pullRequestNumber}`);
  const subtitle = escapeHtml(`${getAuthorLabel(entry.authorLogin)} · Created ${formatDateOnly(entry.createdAtUtc)}`);
  const summary = escapeHtml(buildSummary(entry, preview));
  const stateText = escapeHtml(buildChipLabel(preview, entry));
  const stateClass = escapeHtml(getStateClass(preview, entry));
  const statusText = escapeHtml(buildStatusText(preview, entry));
  const updatedText = escapeHtml(buildUpdatedLabel(preview, entry));
  const stageText = buildStageDisplay(preview, entry);
  const stagePill = stageText
    ? `<span class="preview-meta-pill">${escapeHtml(stageText)}</span>`
    : "";
  const openPullRequestAction = entry.pullRequestUrl
    ? `
        <a class="action-link action-link-github" href="${escapeHtml(entry.pullRequestUrl)}" target="_blank" rel="noreferrer noopener">
          <span class="action-icon action-icon-github" aria-hidden="true"></span>
          <span>Open PR</span>
        </a>`
    : "";
  const draftBadge = entry.isDraft
    ? '<span class="status-chip draft">Draft</span>'
    : "";

  return `
    <article class="preview-card">
      <header class="preview-card-header">
        <div class="preview-card-heading">
          <p class="eyebrow">PR #${entry.pullRequestNumber}</p>
          <div class="preview-title-row">
            <h2 class="preview-title">${title}</h2>
            ${draftBadge}
          </div>
          <p class="preview-card-subtitle">${subtitle}</p>
        </div>
        <span class="status-chip ${stateClass}">${stateText}</span>
      </header>

      <p class="preview-summary">${summary}</p>

      <div class="preview-card-footer">
        <div class="preview-card-meta">
          <span class="preview-meta-pill">${statusText}</span>
          ${stagePill}
          <span class="preview-meta-pill">${updatedText}</span>
        </div>

        <div class="preview-card-actions">
          <a class="action-button primary" href="${previewPath}">Open preview</a>
          ${openPullRequestAction}
        </div>
      </div>
    </article>`;
}

function renderEmptyState(message) {
  previewGrid.innerHTML = `
    <article class="empty-card">
      <h2>${escapeHtml(message)}</h2>
      <p class="collection-summary">Open a route like <code>/prs/{number}/</code> to resolve a PR, prepare its latest frontend artifact, and add it to the warm preview window.</p>
    </article>`;
}

function syncAuthorFilter(entries) {
  const authorOptions = buildAuthorOptions(entries);

  if (selectedAuthor && !authorOptions.some((option) => option.value === selectedAuthor)) {
    selectedAuthor = "";
  }

  authorFilter.innerHTML = [
    '<option value="">All authors</option>',
    ...authorOptions.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`),
  ].join("\n");

  authorFilter.value = selectedAuthor;
}

function buildAuthorOptions(entries) {
  const seen = new Set();
  const options = [];

  for (const entry of entries) {
    const value = getAuthorValue(entry.authorLogin);
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    options.push({
      value,
      label: getAuthorLabel(entry.authorLogin),
    });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
}

function applyAuthorFilter(entries) {
  if (!selectedAuthor) {
    return entries;
  }

  return entries.filter((entry) => getAuthorValue(entry.authorLogin) === selectedAuthor);
}

function getSelectedAuthorLabel() {
  const selectedOption = authorFilter.selectedOptions[0];
  return selectedOption?.textContent?.trim() || "the selected author";
}

function getAuthorValue(authorLogin) {
  return authorLogin
    ? `author:${String(authorLogin).toLowerCase()}`
    : "author:unknown";
}

function getAuthorLabel(authorLogin) {
  return authorLogin
    ? `@${authorLogin}`
    : "Unknown";
}

function buildSummary(entry, preview) {
  if (!preview) {
    return "Open the preview route to resolve the latest successful frontend build for this pull request on demand.";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "This pull request has newer commits than the tracked preview. Open it again after CI finishes to warm the latest build.";
  }

  switch (preview.state) {
    case "Ready":
      return "The latest tracked preview is ready to serve.";
    case "Loading":
      return "The preview host is preparing this build right now.";
    case "Registered":
      return "A newer build is registered and will warm on the next visit.";
    case "Cancelled":
      return "Preparation was cancelled. Re-open the preview when you are ready.";
    case "Failed":
      return preview.error ?? preview.message ?? "The preview host could not finish preparing this build.";
    case "Evicted":
      return "This preview was evicted from the warm window and will prepare again on demand.";
    default:
      return preview.message ?? "Waiting for preview activity.";
  }
}

function buildStatusText(preview, entry) {
  if (!preview) {
    return "Preview on demand";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "Fresh build pending";
  }

  switch (preview.state) {
    case "Ready":
      return "Preview ready";
    case "Loading":
      return `${preview.percent ?? 0}% overall`;
    case "Registered":
      return "Queued to warm";
    case "Cancelled":
      return "Preparation cancelled";
    case "Failed":
      return "Needs attention";
    case "Evicted":
      return "Warms on next visit";
    default:
      return preview.state ?? "Unknown";
  }
}

function buildUpdatedLabel(preview, entry) {
  const timestamp = preview?.updatedAtUtc ?? entry.updatedAtUtc;
  return preview ? `Updated ${formatUpdated(timestamp)}` : `PR updated ${formatUpdated(timestamp)}`;
}

function buildStageDisplay(preview, entry) {
  if (!preview) {
    return "";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "Awaiting CI";
  }

  return preview.state === "Loading"
    ? preview.stage ?? "Preparing"
    : "";
}

function buildChipLabel(preview, entry) {
  if (!preview) {
    return "On demand";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "Outdated";
  }

  switch (preview.state) {
    case "Ready":
      return "Ready";
    case "Loading":
      return "Preparing";
    case "Registered":
      return "Queued";
    case "Cancelled":
      return "Cancelled";
    case "Failed":
      return "Failed";
    case "Evicted":
      return "Evicted";
    default:
      return preview.state ?? "Unknown";
  }
}

function getStateClass(preview, entry) {
  if (!preview) {
    return "missing";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "outdated";
  }

  return String(preview.state ?? "missing").toLowerCase();
}

function formatDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Waiting" : dateFormatter.format(date);
}

function formatUpdated(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Waiting"
    : `${dateFormatter.format(date)} · ${clockFormatter.format(date)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
