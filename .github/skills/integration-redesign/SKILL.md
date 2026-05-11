---
name: integration-redesign
description: Restructures an existing Aspire integration's documentation to match the PostgreSQL multi-page design — get-started, host, connect, and (optionally) extensions pages — with connection-property tables, multi-language consuming-app examples, Mermaid diagrams, and consistent sidebar entries.
---

# Integration Redesign Skill

This skill rewrites an existing Aspire integration's documentation so it matches the structure, depth, and content patterns established by the **PostgreSQL** integration docs. Use it when a maintainer nominates an integration for the redesign.

## When to use this skill

- A user asks you to "redesign", "restructure", or "apply the PostgreSQL pattern" to an integration.
- A user says something like "apply the new doc structure to Redis/MongoDB/Kafka/…".
- The target integration's docs are in a single page or use the older multi-page layout that lacks connection-property tables, multi-language consuming-app tabs, or Mermaid diagrams.

## Goal

Transform the nominated integration's documentation from its current state into a set of pages that mirror the PostgreSQL integration:

| Page | Purpose | PostgreSQL exemplar |
|------|---------|---------------------|
| `{name}-get-started.mdx` | Value proposition, architecture diagram, guided entry points | `postgres-get-started.mdx` |
| `{name}-host.mdx` | Complete AppHost hosting API reference (C# + TypeScript tabs) | `postgres-host.mdx` |
| `{name}-connect.mdx` | Connection properties tables + per-language consuming-app examples | `postgres-connect.mdx` |
| `{name}-extensions.mdx` *(optional)* | Community Toolkit extensions (management UIs, etc.) | `postgresql-extensions.mdx` |

## Reference files — read these first

Before writing anything, **read the PostgreSQL exemplar files in full**. They are the single source of truth for structure, tone, and component usage:

```
src/frontend/src/content/docs/integrations/databases/postgres/postgres-get-started.mdx
src/frontend/src/content/docs/integrations/databases/postgres/postgres-host.mdx
src/frontend/src/content/docs/integrations/databases/postgres/postgres-connect.mdx
src/frontend/src/content/docs/integrations/databases/postgres/postgresql-extensions.mdx
```

Also read the **doc-writer skill** for site-wide conventions that apply to all documentation:

```
.github/skills/doc-writer/SKILL.md
```

## Step-by-step workflow

### 1. Gather context about the target integration

Before rewriting, collect the following information:

- **Read the existing docs** for the target integration (all `.mdx` files in its directory).
- **Identify the integration's NuGet packages** — both hosting (`Aspire.Hosting.*`) and client (`Aspire.*`).
- **Identify the container image** used by the hosting integration (e.g., `docker.io/library/postgres`).
- **Check whether the Aspire TypeScript AppHost SDK supports this integration.** Search for relevant APIs in the product source or documentation. If TypeScript is not supported, show C#-only examples without a `<Tabs>` wrapper and add an `<Aside>` noting that TypeScript support is not yet available.
- **Look up the technology's official site** for accurate descriptions and links.
- **Check the sidebar** (`src/frontend/config/sidebar/integrations.topics.ts`) for the current navigation entries.
- **Check for a community toolkit extensions package** for the integration. If one exists, create the extensions page.
- **Check for icons** in `src/frontend/src/assets/icons/` — reuse the existing icon import.

### 2. Create the get-started page

**File:** `{name}-get-started.mdx`

Follow the structure of `postgres-get-started.mdx` exactly:

#### Frontmatter

```yaml
---
title: Get started with the {Technology} integrations
description: Understand how the Aspire {Technology} integrations fit together — model a {resource type} resource in your AppHost, then connect to it from any consuming app.
---
```

#### Imports

```tsx
import { Image } from 'astro:assets';
import { LinkButton, Steps } from '@astrojs/starlight/components';
import techIcon from '@assets/icons/{icon-file}';
```

#### Body structure

1. **Icon + intro paragraph** — float the icon left; write one paragraph describing the technology and what the Aspire integration does.

2. **`## Why use {Technology} with Aspire`** — a bullet list of concrete benefits. Always include these benefit categories (adapted for the technology):
   - Zero-config local development (container image, auto-generated credentials)
   - Consistent connection info across languages (environment variable injection)
   - Built-in health checks
   - Dashboard observability
   - First-class C# client integration (if a client package exists)
   - Upgrade path to a managed cloud service (if applicable — e.g., Azure)

3. **`## How the pieces fit together`** — explanatory prose + a Mermaid `architecture-beta` diagram showing AppHost → resource → consuming app flow. Follow the PostgreSQL diagram structure:
   ```mermaid
   architecture-beta

     group apphost(server)[AppHost]
     group consumer(server)[Consuming app]

     service hosting(server)[Hosting integration] in apphost
     service tech(logos:{logo})[{Technology} server] in apphost
     service db(database)[{resourcename}] in apphost

     service client(iconoir:server-connection)[Client integration] in consumer
     service app(server)[App] in consumer

     hosting:R --> L:tech
     tech:R --> L:db
     db:R --> L:client
     client:R --> L:app
   ```
   Adapt the diagram for the technology. Not all integrations have a separate "database" child resource — some only have a server resource. Adjust accordingly.

4. **`<Steps>` with `<LinkButton>` CTAs** — two steps:
   - Model {Technology} in your AppHost → links to the host page
   - Connect from your consuming app → links to the connect page

5. **`## See also`** — link to extensions page (if applicable) and any other related docs.

### 3. Create the host page

**File:** `{name}-host.mdx`

Follow the structure of `postgres-host.mdx`:

#### Frontmatter

```yaml
---
title: Set up {Technology} in the AppHost
description: Learn how to use the Aspire {Technology} Hosting integration to orchestrate and configure a {resource type} in an Aspire solution.
---
```

#### Imports

```tsx
import { Image } from 'astro:assets';
import { Aside, Steps, Tabs, TabItem } from '@astrojs/starlight/components';
import LearnMore from '@components/LearnMore.astro';
import techIcon from '@assets/icons/{icon-file}';
```

#### Body structure

1. **Icon + intro paragraph** — reference what this page covers and cross-link to the get-started and connect pages.

2. **`## Installation`** — show `aspire add {shortname}` and manual installation options, inside `<Tabs syncKey="aspire-lang">` for C# and TypeScript.

3. **`## Add {Technology} resource`** — the core resource creation example with C#/TypeScript tabs using `<Tabs syncKey="aspire-lang">`. Follow with a `<Steps>` block explaining what happens under the hood (container creation, default credentials, connection reference injection).

4. **Feature-specific sections** — one `##` section per capability. Typical sections (include only those that apply):
   - Add resource with data volume
   - Add resource with data bind mount
   - Add resource with init bind mount / init files
   - Add resource with parameters (explicit credentials)
   - Add management UI resources (e.g., pgAdmin, pgWeb, RedisInsight)
   - Pass custom environment variables
   - Configure host ports

   Each section should have C#/TypeScript tabbed examples using `<Tabs syncKey="aspire-lang">`.

5. **`## Connection properties`** — brief cross-reference to the connect page: "For the full reference of {Technology} connection properties — and how consuming apps in C#, TypeScript, Python, and Go read them — see [Connect to {Technology}](../{name}-connect/)."

6. **`## Hosting integration health checks`** — describe the automatic health check and link to the health-check NuGet package.

#### Code example conventions

- Use `<Tabs syncKey="aspire-lang">` with `<TabItem id="csharp" label="C#">` and `<TabItem id="typescript" label="TypeScript">`.
- C# code blocks: `title="C# — AppHost.cs"`
- TypeScript code blocks: `title="TypeScript — apphost.ts" twoslash`
- TypeScript builder pattern: `import { createBuilder } from './.modules/aspire.js';` followed by `const builder = await createBuilder();`
- End all AppHost code examples with the comment `// After adding all resources, run the app...`
- Use 4-space indentation for fluent API continuation lines.

### 4. Create the connect page

**File:** `{name}-connect.mdx`

Follow the structure of `postgres-connect.mdx`:

#### Frontmatter

```yaml
---
title: Connect to {Technology}
description: Learn how to connect to {Technology} from C#, Go, Python, and TypeScript consuming apps in an Aspire solution.
---
```

#### Imports

```tsx
import { Image } from 'astro:assets';
import { Aside, Tabs, TabItem } from '@astrojs/starlight/components';
import InstallDotNetPackage from '@components/InstallDotNetPackage.astro';
import techIcon from '@assets/icons/{icon-file}';
```

#### Body structure

1. **Icon + intro paragraph** — explain that this page covers how consuming apps connect, and cross-link to the host page. Explain the environment variable injection mechanism.

2. **`## Connection properties`** — one or more Markdown tables listing the connection properties Aspire injects as environment variables. Follow the PostgreSQL format:
   - Table columns: `Property Name` | `Description`
   - Include properties like `Host`, `Port`, `Username`, `Password`, `Uri`, `ConnectionString`, etc.
   - Show example connection strings after each table.
   - If the integration has both a "server" and a "database" child resource, show separate tables for each (the database table inherits from the server and adds database-specific properties).

   > **Important:** Research the actual connection properties that Aspire injects for this integration. Check the Aspire source code or existing documentation. Do NOT guess — if you cannot verify the exact property names, flag them for review.

3. **`## Connect from your app`** — a brief intro followed by language-specific tabs:

   ```mdx
   <Tabs syncKey="{name}-consuming-lang">
   <TabItem label="C#">
   ...
   </TabItem>
   <TabItem label="Go">
   ...
   </TabItem>
   <TabItem label="Python">
   ...
   </TabItem>
   <TabItem label="TypeScript">
   ...
   </TabItem>
   </Tabs>
   ```

   **C# tab** (most detailed — follows PostgreSQL pattern):
   - Install the client integration package (`<InstallDotNetPackage>`)
   - Add the client (e.g., `builder.AddNpgsqlDataSource`)
   - Add keyed clients
   - Configuration (connection strings, configuration providers, inline delegates)
   - Client integration health checks
   - Observability and telemetry (logging categories, tracing activities, metrics)
   - Read environment variables directly (fallback approach)

   **Go, Python, TypeScript tabs** — show the idiomatic driver/client library for that language:
   - Install command (go get / pip install / npm install)
   - Read the Aspire-injected environment variable and connect
   - Keep examples concise but complete and runnable

4. **Closing `<Aside>`** — tip about custom environment variables linking back to the host page.

### 5. Create the extensions page (optional)

**File:** `{name}-extensions.mdx`

Only create this page if a Community Toolkit extensions package exists for the integration. Follow `postgresql-extensions.mdx`:

#### Body structure

1. `<Badge text="⭐ Community Toolkit" variant="tip" size="large" />`
2. Icon + intro paragraph
3. `## Hosting integration` — install the extensions package
4. `## Add management UI` — one subsection per management UI tool
5. `## See also` — links to the management tools' docs, the main integration host page, and the Aspire Community Toolkit

### 6. Update the sidebar

Edit `src/frontend/config/sidebar/integrations.topics.ts` to add or update entries for the integration. Follow the PostgreSQL sidebar pattern:

```typescript
{
  label: '{Technology}',
  collapsed: true,
  items: [
    {
      label: 'Get started',
      slug: 'integrations/{category}/{name}/{name}-get-started',
    },
    {
      label: 'Set up {Technology} in the AppHost',
      slug: 'integrations/{category}/{name}/{name}-host',
    },
    {
      label: 'Connect to {Technology}',
      slug: 'integrations/{category}/{name}/{name}-connect',
    },
    // Only if extensions page exists:
    {
      label: 'Use community extensions',
      slug: 'integrations/{category}/{name}/{name}-extensions',
    },
  ],
},
```

### 7. Handle redirects

If existing pages are being renamed or restructured, add redirect entries in `src/frontend/config/redirects.mjs` so old URLs continue to work.

### 8. Validate

1. Check that all internal cross-links between the new pages are correct.
2. Verify icon imports resolve to existing files in `src/frontend/src/assets/icons/`.
3. Ensure the sidebar entries use the correct slugs.
4. Run the site locally if possible to verify rendering.

### 9. Run the doc-tester skill

After all pages have been written and validated, invoke the **doc-tester** skill to audit the newly created documentation. Pass it the URLs (or file paths) of the pages you just created so it can verify:

- The documentation is accurate and teaches effectively.
- Code examples are correct and runnable.
- Cross-links resolve properly on the rendered site.
- No knowledge gaps exist that would block a new user.

If the doc-tester reports issues, fix them before considering the redesign complete.

## Content quality guidelines

### Connection properties

- **Always research the actual properties** that Aspire injects for the integration. These vary per integration — do not copy the PostgreSQL properties verbatim.
- Check the Aspire source code (`ResourceConnectionProperties` or similar) to find the exact property names and formats.
- If you cannot verify properties, add an `<!-- TODO: verify connection properties -->` comment and flag for review.

### Multi-language examples

- **C# tab**: Always the most detailed. Include the full client integration (DI registration, keyed clients, configuration, health checks, telemetry).
- **Go, Python, TypeScript tabs**: Show the most popular/recommended client library. Keep examples idiomatic and runnable.
- Use the Aspire-injected `{RESOURCE}_URI` or `{RESOURCE}_CONNECTIONSTRING` environment variable when the technology supports URI-based connections.
- Show individual property access (`{RESOURCE}_HOST`, `{RESOURCE}_PORT`, etc.) when URI is not available.

### Mermaid diagrams

- Use the `architecture-beta` diagram type.
- Adapt the PostgreSQL diagram for the technology's resource model (some integrations have only a server resource, others have server + database, others have server + topic/queue, etc.).
- Use appropriate Mermaid icons from the `logos:` namespace when available, or generic `server`/`database` icons.

### Tone and style

- Follow all guidelines from the doc-writer skill (`.github/skills/doc-writer/SKILL.md`).
- Use second person ("you"), active voice, imperative mood.
- Be concise but complete.
- Use consistent terminology: "resource" not "component", "integration" not "connector".

## Things to avoid

- **Do NOT copy PostgreSQL-specific content** (Npgsql, pgAdmin, etc.) into other integrations. Adapt every section for the target technology.
- **Do NOT invent API surfaces.** If you're unsure whether an API exists (e.g., `WithDataVolume` for a specific integration), verify in the existing docs or source code first.
- **Do NOT create TypeScript examples** unless you've confirmed the TypeScript AppHost SDK supports the integration. Use a note if it doesn't.
- **Do NOT remove existing content** that is accurate and useful — incorporate it into the new structure.
- **Do NOT guess connection properties** — research them from the Aspire source or existing documentation.

## Checklist

Before considering the work complete, verify:

- [ ] All four pages (or three if no extensions) follow the PostgreSQL structure
- [ ] `get-started` has: value props, Mermaid diagram, `<Steps>` with `<LinkButton>` CTAs
- [ ] `host` has: installation, resource creation with C#/TS tabs, all applicable features, health checks
- [ ] `connect` has: connection properties tables, multi-language tabs (C#/Go/Python/TypeScript), C# client integration detail
- [ ] Extensions page (if applicable) has: Community Toolkit badge, management UI examples
- [ ] All cross-links between pages are correct
- [ ] Sidebar updated in `integrations.topics.ts`
- [ ] Redirects added if old URLs changed
- [ ] Icons import existing files from `@assets/icons/`
- [ ] No PostgreSQL-specific content leaked into the target integration
- [ ] Connection properties are verified, not guessed
- [ ] Doc-tester skill has been run against the new pages and all reported issues resolved
