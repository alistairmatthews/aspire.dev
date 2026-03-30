const previewGrid = document.getElementById("preview-grid");
const windowCapacity = document.getElementById("window-capacity");
const windowCount = document.getElementById("window-count");
const authorFilterBar = document.getElementById("author-filter-bar");

const numberFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

let catalogEntries = [];
let selectedAuthor = "";
let activePreviewCount = 0;
let maxActivePreviews = 0;
let openPullRequestCount = 0;

authorFilterBar.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-author-value]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  selectedAuthor = button.dataset.authorValue ?? "";
  syncAuthorFilter(catalogEntries);
  renderCatalog();
});

loadCatalog().catch((error) => {
  previewGrid.setAttribute("aria-busy", "false");
  authorFilterBar.setAttribute("aria-busy", "false");
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

  previewGrid.setAttribute("aria-busy", "false");
  authorFilterBar.setAttribute("aria-busy", "false");

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
  const stateText = escapeHtml(buildChipLabel(preview, entry));
  const stateClass = escapeHtml(getStateClass(preview, entry));
  const statusDetail = escapeHtml(buildStatusDetail(preview, entry));
  const openPullRequestAction = entry.pullRequestUrl
    ? `
        <a class="icon-button" href="${escapeHtml(entry.pullRequestUrl)}" target="_blank" rel="noreferrer noopener" aria-label="Open pull request on GitHub">
          <span class="action-icon action-icon-github" aria-hidden="true"></span>
        </a>`
    : "";
  const draftBadge = entry.isDraft
    ? '<span class="status-chip draft">Draft</span>'
    : "";

  return `
    <article class="preview-card">
      <div class="preview-card-topline">
        <p class="eyebrow">PR #${entry.pullRequestNumber}</p>
        <div class="preview-card-tools">
          ${draftBadge}
          ${openPullRequestAction}
        </div>
      </div>

      <a class="preview-card-link" href="${previewPath}">
        <h2 class="preview-title">${title}</h2>
        <p class="preview-card-subtitle">${subtitle}</p>
        <div class="preview-card-status-row">
          <span class="status-chip ${stateClass}">${stateText}</span>
          <span class="preview-status-detail">${statusDetail}</span>
        </div>
      </a>
    </article>`;
}

function renderEmptyState(message) {
  previewGrid.setAttribute("aria-busy", "false");
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

  const allButton = renderFilterButton({
    value: "",
    label: "All",
  });

  authorFilterBar.innerHTML = [
    allButton,
    ...authorOptions.map(renderFilterButton),
  ].join("\n");
}

function renderFilterButton(option) {
  const activeClass = option.value === selectedAuthor ? " is-active" : "";
  return `<button type="button" class="filter-pill${activeClass}" data-author-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`;
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
  const selectedButton = authorFilterBar.querySelector(".filter-pill.is-active");
  return selectedButton?.textContent?.trim() || "the selected author";
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

function buildStatusDetail(preview, entry) {
  if (!preview) {
    return "Loads on first visit.";
  }

  if (preview.headSha && entry.headSha && preview.headSha !== entry.headSha) {
    return "New commits are waiting for a fresh CI build.";
  }

  switch (preview.state) {
    case "Ready":
      return "Served from the warm window.";
    case "Loading":
      return preview.stage ? `${preview.stage} · ${preview.percent ?? 0}%` : `${preview.percent ?? 0}%`;
    case "Registered":
      return "Latest build is queued to warm.";
    case "Cancelled":
      return "Preparation was cancelled.";
    case "Failed":
      return preview.error ?? preview.message ?? "The preview host could not finish preparing this build.";
    case "Evicted":
      return "Loads again on the next visit.";
    default:
      return preview.message ?? "Waiting for preview activity.";
  }
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
