import {
  Bot,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  History,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Grain = "month" | "week" | "day";
type Theme = "dark" | "light";
type LoadState = "loading" | "ready" | "error";
type AccessState = "checking" | "locked" | "unlocked" | "error";

type RaindropItem = {
  _id: number;
  title?: string;
  link?: string;
  domain?: string;
  created?: string;
  tags?: string[];
  excerpt?: string;
  cover?: string | null;
  collectionId?: number | { $id?: number; oid?: number };
};

type RaindropListResponse = {
  items?: RaindropItem[];
  count?: number;
};

type RaindropItemResponse = {
  item?: RaindropItem;
};

type CollectionItem = {
  _id?: number;
  id?: number;
  title?: string;
  children?: CollectionItem[];
  items?: CollectionItem[];
};

type CollectionResponse = {
  items?: CollectionItem[];
};

type AccessSession = {
  authenticated: boolean;
  accessEnabled: boolean;
};

type AgentKey = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type AgentKeyListResponse = {
  keys: AgentKey[];
};

type AgentKeyCreateResponse = {
  key: AgentKey;
  mcpUrl: string;
};

type AgentAuditEntry = {
  at: string;
  type: string;
  endpoint?: string;
  action?: string;
  bookmarkId?: number;
  collectionId?: number;
  addTags?: string[];
  removeTags?: string[];
};

type AgentAuditResponse = {
  entries: AgentAuditEntry[];
};

type BookmarkLabelsResponse = {
  items: Array<{
    bookmarkId: number;
    tags: string[];
  }>;
};

type Section = {
  key: string;
  start: Date;
  label: string;
  total: number;
  unread: number;
  items: RaindropItem[];
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API_ROOT = "/api/raindrop";
const grains: Grain[] = ["month", "week", "day"];
const currentYear = new Date().getFullYear();

export function App() {
  const [items, setItems] = useState<RaindropItem[]>([]);
  const [collections, setCollections] = useState<Record<number, string>>({});
  const [grain, setGrain] = useState<Grain>("week");
  const [theme, setTheme] = useState<Theme>(() => readCurrentTheme());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total?: number }>({ loaded: 0 });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = useState<Record<number, string>>({});
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [accessEnabled, setAccessEnabled] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  const [agentKeys, setAgentKeys] = useState<AgentKey[]>([]);
  const [agentError, setAgentError] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentCreating, setAgentCreating] = useState(false);
  const [agentMcpLink, setAgentMcpLink] = useState("");
  const [copiedAgentMcpLink, setCopiedAgentMcpLink] = useState(false);
  const [auditKeyId, setAuditKeyId] = useState("");
  const [agentAudit, setAgentAudit] = useState<AgentAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [labelingSectionKeys, setLabelingSectionKeys] = useState<Set<string>>(new Set());
  const [labelErrors, setLabelErrors] = useState<Record<string, string>>({});
  const [labelDialogItem, setLabelDialogItem] = useState<RaindropItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const activeLoad = useRef(0);

  const loadFeed = useCallback(async () => {
    const loadId = activeLoad.current + 1;
    activeLoad.current = loadId;

    setLoadState("loading");
    setError("");
    setProgress({ loaded: 0 });

    try {
      const [collectionRoot, collectionChildren] = await Promise.all([
        apiJson<CollectionResponse>("/collections"),
        apiJson<CollectionResponse>("/collections/childrens"),
      ]);

      const collectionMap = buildCollectionMap([collectionRoot, collectionChildren]);
      const allItems = await fetchAllRaindrops((loaded, total) => {
        if (activeLoad.current === loadId) {
          setProgress({ loaded, total });
        }
      });

      if (activeLoad.current !== loadId) {
        return;
      }

      setCollections(collectionMap);
      setItems(allItems);
      setLoadState("ready");
    } catch (caught) {
      if (activeLoad.current !== loadId) {
        return;
      }

      if (caught instanceof ApiError && caught.status === 401) {
        setItems([]);
        setCollections({});
        setAccessState("locked");
        return;
      }

      setLoadState("error");
      setError(getReadableError(caught));
    }
  }, []);

  const checkAccess = useCallback(async () => {
    setAccessState("checking");

    try {
      const session = await getAccessSession();
      setAccessEnabled(session.accessEnabled);
      setAccessState(session.authenticated ? "unlocked" : "locked");
    } catch (caught) {
      setError(getReadableError(caught));
      setAccessState("error");
    }
  }, []);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (accessState === "unlocked") {
      loadFeed();
    }
  }, [accessState, loadFeed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.cookie = `rf_theme=${theme}; path=/; SameSite=Lax`;
  }, [theme]);

  const filteredItems = useMemo(() => filterItems(items, searchQuery), [items, searchQuery]);
  const sections = useMemo(() => groupIntoSections(filteredItems, grain), [filteredItems, grain]);
  const sectionKeys = useMemo(() => sections.map((section) => section.key), [sections]);
  const isSearching = searchQuery.trim().length > 0;

  useEffect(() => {
    setExpandedKeys((previous) => {
      const valid = new Set([...previous].filter((key) => sectionKeys.includes(key)));

      if (valid.size === 0 && sectionKeys[0]) {
        valid.add(sectionKeys[0]);
      }

      return valid;
    });
  }, [sectionKeys]);

  useEffect(() => {
    if (sectionKeys[0]) {
      setExpandedKeys(new Set([sectionKeys[0]]));
    }
  }, [grain, sectionKeys]);

  const unreadTotal = useMemo(() => items.filter((item) => !isRead(item)).length, [items]);
  const visibleUnreadTotal = useMemo(() => filteredItems.filter((item) => !isRead(item)).length, [filteredItems]);

  async function toggleRead(item: RaindropItem) {
    const itemId = item._id;
    const nextRead = !isRead(item);
    const previousItems = items;
    const optimisticTags = mergeReadTag(item.tags || [], nextRead);

    setPendingActions((previous) => ({ ...previous, [itemId]: "read" }));
    setItems((current) => patchItemTags(current, itemId, optimisticTags));

    try {
      const current = await apiJson<RaindropItemResponse>(`/raindrop/${itemId}`);
      const currentTags = current.item?.tags || item.tags || [];
      const nextTags = mergeReadTag(currentTags, nextRead);
      const updated = await apiJson<RaindropItemResponse>(`/raindrop/${itemId}`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags }),
      });

      setItems((currentItems) =>
        currentItems.map((candidate) =>
          candidate._id === itemId
            ? {
                ...candidate,
                ...(updated.item || {}),
                tags: updated.item?.tags || nextTags,
              }
            : candidate,
        ),
      );
    } catch (caught) {
      setItems(previousItems);
      setError(getReadableError(caught));
    } finally {
      setPendingActions((previous) => omitKey(previous, itemId));
    }
  }

  async function deleteItem(item: RaindropItem) {
    const confirmed = window.confirm("Move this bookmark to Raindrop Trash?");

    if (!confirmed) {
      return;
    }

    const previousItems = items;

    setPendingActions((previous) => ({ ...previous, [item._id]: "delete" }));
    setItems((current) => current.filter((candidate) => candidate._id !== item._id));

    try {
      await apiJson(`/raindrop/${item._id}`, {
        method: "DELETE",
      });
    } catch (caught) {
      setItems(previousItems);
      setError(getReadableError(caught));
    } finally {
      setPendingActions((previous) => omitKey(previous, item._id));
    }
  }

  async function signIn(password: string) {
    await startAccessSession(password);
    await checkAccess();
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    activeLoad.current += 1;
    setItems([]);
    setCollections({});
    setPendingActions({});
    setAgentDialogOpen(false);
    setAgentMcpLink("");
    setLabelDialogItem(null);
    setAccessState("locked");
  }

  async function addLabels(section: Section) {
    const unlabeledItems = section.items.filter(hasNoLabels);

    if (unlabeledItems.length === 0) {
      return;
    }

    setLabelingSectionKeys((previous) => new Set(previous).add(section.key));
    setLabelErrors((previous) => {
      const next = { ...previous };
      delete next[section.key];
      return next;
    });
    let failed = false;
    let failureMessage = "";

    try {
      for (const batch of chunk(unlabeledItems, 12)) {
        try {
          const response = await apiJson<BookmarkLabelsResponse>("/labels", {
            method: "POST",
            body: JSON.stringify({ bookmarkIds: batch.map((item) => item._id) }),
          });

          setItems((currentItems) =>
            response.items.reduce(
              (nextItems, updatedItem) => patchItemTags(nextItems, updatedItem.bookmarkId, updatedItem.tags),
              currentItems,
            ),
          );
        } catch (caught) {
          failed = true;
          failureMessage ||= getReadableError(caught);
        }
      }

      if (failed) {
        setLabelErrors((previous) => ({
          ...previous,
          [section.key]: `${failureMessage || "Some bookmarks could not be labeled."} Use the section action again to retry them.`,
        }));
      }
    } finally {
      setLabelingSectionKeys((previous) => {
        const next = new Set(previous);
        next.delete(section.key);
        return next;
      });
    }
  }

  async function addManualLabel(item: RaindropItem, rawLabel: string) {
    const label = normalizeManualLabel(rawLabel);

    if (!label) {
      throw new ApiError("Enter a label using up to 40 characters.", 400);
    }

    if (label === "read") {
      throw new ApiError("The read label is reserved for the read status.", 400);
    }

    setPendingActions((previous) => ({ ...previous, [item._id]: "label" }));

    try {
      const current = await apiJson<RaindropItemResponse>(`/raindrop/${item._id}`);
      const currentTags = current.item?.tags || item.tags || [];
      const nextTags = appendLabel(currentTags, label);

      if (nextTags.length === currentTags.length) {
        return;
      }

      const updated = await apiJson<RaindropItemResponse>(`/raindrop/${item._id}`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags }),
      });
      const updatedTags = updated.item?.tags || nextTags;

      setItems((currentItems) => patchItemTags(currentItems, item._id, updatedTags));
      setLabelDialogItem((currentItem) => (currentItem ? { ...currentItem, tags: updatedTags } : null));
    } finally {
      setPendingActions((previous) => omitKey(previous, item._id));
    }
  }

  async function removeManualLabel(item: RaindropItem, label: string) {
    setPendingActions((previous) => ({ ...previous, [item._id]: "label" }));

    try {
      const current = await apiJson<RaindropItemResponse>(`/raindrop/${item._id}`);
      const currentTags = current.item?.tags || item.tags || [];
      const nextTags = currentTags.filter((tag) => tag.toLocaleLowerCase() !== label.toLocaleLowerCase());

      if (nextTags.length === currentTags.length) {
        return;
      }

      const updated = await apiJson<RaindropItemResponse>(`/raindrop/${item._id}`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags }),
      });
      const updatedTags = updated.item?.tags || nextTags;

      setItems((currentItems) => patchItemTags(currentItems, item._id, updatedTags));
      setLabelDialogItem((currentItem) => (currentItem ? { ...currentItem, tags: updatedTags } : null));
    } finally {
      setPendingActions((previous) => omitKey(previous, item._id));
    }
  }

  async function openAgentManager() {
    setAgentDialogOpen(true);
    setAgentError("");
    setAuditKeyId("");
    setAgentAudit([]);
    setAgentLoading(true);

    try {
      const response = await agentKeyJson<AgentKeyListResponse>("/api/agent-keys");
      setAgentKeys(response.keys);
    } catch (caught) {
      setAgentError(getReadableError(caught));
    } finally {
      setAgentLoading(false);
    }
  }

  async function createAgentLink() {
    setAgentCreating(true);
    setAgentError("");

    try {
      const response = await agentKeyJson<AgentKeyCreateResponse>("/api/agent-keys", { method: "POST" });
      setAgentKeys((current) => [response.key, ...current]);
      setAgentMcpLink(response.mcpUrl);
      setCopiedAgentMcpLink(false);
    } catch (caught) {
      setAgentError(getReadableError(caught));
    } finally {
      setAgentCreating(false);
    }
  }

  async function revokeAgentLink(key: AgentKey) {
    const confirmed = window.confirm(`Revoke ${key.label}? Any AI chat using this link will immediately lose access.`);

    if (!confirmed) {
      return;
    }

    setAgentError("");

    try {
      const response = await agentKeyJson<{ key: AgentKey }>(`/api/agent-keys/${key.id}`, { method: "DELETE" });
      setAgentKeys((current) => current.map((candidate) => (candidate.id === key.id ? response.key : candidate)));

      if (auditKeyId === key.id) {
        setAuditKeyId("");
        setAgentAudit([]);
      }
    } catch (caught) {
      setAgentError(getReadableError(caught));
    }
  }

  async function showAgentActivity(key: AgentKey) {
    setAgentError("");
    setAuditKeyId(key.id);
    setAuditLoading(true);

    try {
      const response = await agentKeyJson<AgentAuditResponse>(`/api/agent-keys/${key.id}/audit`);
      setAgentAudit(response.entries);
    } catch (caught) {
      setAgentError(getReadableError(caught));
      setAgentAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }

  async function copyAgentMcpLink() {
    if (!agentMcpLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(agentMcpLink);
      setCopiedAgentMcpLink(true);
    } catch {
      setAgentError("Could not copy the ChatGPT connection link. Select the link and copy it manually.");
    }
  }

  const isBusy = loadState === "loading";

  if (accessState === "checking") {
    return <AccessStatus />;
  }

  if (accessState === "locked") {
    return <AccessGate onSubmit={signIn} />;
  }

  if (accessState === "error") {
    return <AccessCheckError message={error} onRetry={checkAccess} />;
  }

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <span className="eyebrow">Raindrop Feed</span>
          <h1>Saved links</h1>
        </div>

        <div className="topControls" aria-label="Feed controls">
          <div className="segmented" aria-label="Time grouping">
            {grains.map((candidate) => (
              <button
                key={candidate}
                className={candidate === grain ? "active" : ""}
                type="button"
                onClick={() => setGrain(candidate)}
              >
                {capitalize(candidate)}
              </button>
            ))}
          </div>

          <button
            className="iconButton soft"
            type="button"
            onClick={() => setGuideDialogOpen(true)}
            aria-label="How this feed works"
            title="How this feed works"
          >
            <CircleHelp size={18} />
          </button>

          <button
            className="iconButton soft"
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            className="iconButton soft"
            type="button"
            onClick={() => void openAgentManager()}
            aria-label="Manage agent links"
            title="Manage agent links"
          >
            <Bot size={18} />
          </button>

          <button
            className="iconButton soft"
            type="button"
            onClick={loadFeed}
            aria-label="Refresh feed"
            title="Refresh feed"
            disabled={isBusy}
          >
            <RefreshCw size={18} />
          </button>

          {accessEnabled && (
            <button
              className="iconButton soft"
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>

      <main className="feedFrame">
        <div className="feedToolbar">
          <div className="feedSummary" aria-live="polite">
            <span>{isSearching ? `${filteredItems.length} shown` : `${items.length} saved`}</span>
            <span>{isSearching ? visibleUnreadTotal : unreadTotal} unread</span>
          </div>
          <label className="feedSearch">
            <Search size={17} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search titles or labels"
              aria-label="Search titles or labels"
            />
            {searchQuery && (
              <button
                className="searchClear"
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </label>
        </div>

        {loadState === "loading" && <LoadingState progress={progress} />}

        {loadState === "error" && <ErrorState message={error} onRetry={loadFeed} />}

        {loadState === "ready" && items.length === 0 && <EmptyState />}

        {loadState === "ready" && items.length > 0 && filteredItems.length === 0 && (
          <SearchEmptyState onClear={() => setSearchQuery("")} />
        )}

        {loadState === "ready" && filteredItems.length > 0 && (
          <div className="sectionStack">
            {sections.map((section) => (
              <PeriodSection
                key={section.key}
                section={section}
                expanded={expandedKeys.has(section.key)}
                collectionNames={collections}
                pendingActions={pendingActions}
                onToggle={() => {
                  setExpandedKeys((previous) => {
                    const next = new Set(previous);

                    if (next.has(section.key)) {
                      next.delete(section.key);
                    } else {
                      next.add(section.key);
                    }

                    return next;
                  });
                }}
                onToggleRead={toggleRead}
                onDelete={deleteItem}
                onAddLabels={addLabels}
                onOpenLabels={setLabelDialogItem}
                labeling={labelingSectionKeys.has(section.key)}
                labelError={labelErrors[section.key]}
              />
            ))}
          </div>
        )}
      </main>

      {agentDialogOpen && (
        <AgentKeyDialog
          keys={agentKeys}
          loading={agentLoading}
          creating={agentCreating}
          error={agentError}
          revealedMcpLink={agentMcpLink}
          mcpCopied={copiedAgentMcpLink}
          auditKeyId={auditKeyId}
          audit={agentAudit}
          auditLoading={auditLoading}
          onClose={() => {
            setAgentDialogOpen(false);
            setAgentMcpLink("");
            setCopiedAgentMcpLink(false);
          }}
          onCreate={createAgentLink}
          onCopyMcp={copyAgentMcpLink}
          onRevoke={revokeAgentLink}
          onShowActivity={showAgentActivity}
        />
      )}

      {guideDialogOpen && <FeedGuideDialog onClose={() => setGuideDialogOpen(false)} />}

      {labelDialogItem && (
        <BookmarkLabelDialog
          item={labelDialogItem}
          onClose={() => setLabelDialogItem(null)}
          onSave={addManualLabel}
          onRemove={removeManualLabel}
        />
      )}

    </div>
  );
}

function FeedGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="agentDialog guideDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <div>
            <span id="feed-guide-title" className="eyebrow">How it works</span>
            <p className="dialogDescription">Your private Raindrop library, arranged for reading and organizing.</p>
          </div>
          <button className="iconButton soft" type="button" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="guideSteps">
          <article className="guideStep">
            <span className="guideStepIcon"><MonitorSmartphone size={18} /></span>
            <div>
              <h3>Save from browser or phone</h3>
              <p>
                Use the <a href="https://raindrop.io/download" target="_blank" rel="noreferrer">Raindrop browser extension <ExternalLink size={13} /></a> to save while browsing, or the <a href="https://raindrop.io/download" target="_blank" rel="noreferrer">Raindrop mobile app <ExternalLink size={13} /></a> when you are away from your desk.
              </p>
            </div>
          </article>

          <article className="guideStep">
            <span className="guideStepIcon"><RefreshCw size={18} /></span>
            <div>
              <h3>See every new save here</h3>
              <p>Your feed reads directly from Raindrop. Open it or use the refresh button to pull in the latest saved links immediately.</p>
            </div>
          </article>

          <article className="guideStep">
            <span className="guideStepIcon"><CalendarDays size={18} /></span>
            <div>
              <h3>Read in the rhythm you need</h3>
              <p>Switch between Day, Week, and Month to group bookmarks by when you saved them. Search by title or label whenever you need to find something specific.</p>
            </div>
          </article>

          <article className="guideStep">
            <span className="guideStepIcon"><Sparkles size={18} /></span>
            <div>
              <h3>Label unlabeled bookmarks</h3>
              <p>Add an optional Gemini API key in Vercel, then use the Label action beside a time section to suggest useful labels for its unlabeled bookmarks. You can also add and remove labels on individual cards.</p>
            </div>
          </article>

          <article className="guideStep">
            <span className="guideStepIcon"><Bot size={18} /></span>
            <div>
              <h3>Talk to your bookmarks</h3>
              <p>Open Agent access, create a private MCP link, then add it in ChatGPT or Claude. Your assistant can search the library and, with your confirmation, add labels or move bookmarks.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function AgentKeyDialog({
  keys,
  loading,
  creating,
  error,
  revealedMcpLink,
  mcpCopied,
  auditKeyId,
  audit,
  auditLoading,
  onClose,
  onCreate,
  onCopyMcp,
  onRevoke,
  onShowActivity,
}: {
  keys: AgentKey[];
  loading: boolean;
  creating: boolean;
  error: string;
  revealedMcpLink: string;
  mcpCopied: boolean;
  auditKeyId: string;
  audit: AgentAuditEntry[];
  auditLoading: boolean;
  onClose: () => void;
  onCreate: () => Promise<void>;
  onCopyMcp: () => Promise<void>;
  onRevoke: (key: AgentKey) => Promise<void>;
  onShowActivity: (key: AgentKey) => Promise<void>;
}) {
  const activeKeys = keys.filter((key) => !key.revokedAt);

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="agentDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <div>
            <span id="agent-dialog-title" className="eyebrow">Agent access</span>
            <p className="dialogDescription">Connect Raindrop Feed MCP to talk to your bookmarks.</p>
          </div>
          <button className="iconButton soft" type="button" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </header>

        <section className="agentSection">
          <div className="agentSectionHeader">
            <h3>Active links</h3>
            <button className="dialogAction" type="button" onClick={() => void onCreate()} disabled={creating}>
              {creating ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Create link
            </button>
          </div>

          {error && <p className="agentError">{error}</p>}

          {loading && (
            <div className="agentLoading">
              <Loader2 className="spin" size={19} />
            </div>
          )}

          {!loading && activeKeys.length === 0 && <p className="agentEmpty">No active agent links.</p>}

          {!loading && activeKeys.length > 0 && (
            <ul className="agentKeyList">
              {activeKeys.map((key) => (
                <li key={key.id} className="agentKeyRow">
                  <div className="agentKeyDetails">
                    <strong>{key.label}</strong>
                    <span>
                      Created {formatRelativeDate(key.createdAt)}
                      {key.lastUsedAt ? ` / Used ${formatRelativeDate(key.lastUsedAt)}` : ""}
                    </span>
                  </div>
                  <div className="agentKeyActions">
                    <button
                      className="iconButton soft"
                      type="button"
                      onClick={() => void onShowActivity(key)}
                      aria-label={`View activity for ${key.label}`}
                      title="View activity"
                    >
                      <History size={16} />
                    </button>
                    <button
                      className="iconButton soft danger"
                      type="button"
                      onClick={() => void onRevoke(key)}
                      aria-label={`Revoke ${key.label}`}
                      title="Revoke link"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {revealedMcpLink && (
          <section className="agentReveal agentMcpReveal" aria-label="New MCP link">
            <div className="agentRevealTitle">
              <span>New MCP link</span>
              <span>Shown once</span>
            </div>
            <div className="agentLinkField">
              <input value={revealedMcpLink} readOnly aria-label="MCP connection link" onFocus={(event) => event.currentTarget.select()} />
              <button
                className="iconButton"
                type="button"
                onClick={() => void onCopyMcp()}
                aria-label={mcpCopied ? "MCP connection link copied" : "Copy MCP connection link"}
                title={mcpCopied ? "Copied" : "Copy MCP connection link"}
              >
                <Copy size={17} />
              </button>
            </div>
            {mcpCopied && <span className="copyStatus">Copied</span>}
            <div className="agentConnectionInstructions">
              <p><strong>ChatGPT:</strong> Settings &gt; Security and login &gt; Developer mode, then Plugins &gt; Add. Authentication: No Auth.</p>
              <p><strong>Claude:</strong> Customize &gt; Connectors &gt; Add custom connector.</p>
            </div>
          </section>
        )}

        {auditKeyId && (
          <section className="agentSection agentActivity" aria-live="polite">
            <h3>Recent activity</h3>
            {auditLoading && (
              <div className="agentLoading">
                <Loader2 className="spin" size={19} />
              </div>
            )}
            {!auditLoading && audit.length === 0 && <p className="agentEmpty">No activity yet.</p>}
            {!auditLoading && audit.length > 0 && (
              <ul className="agentAuditList">
                {audit.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span>{formatAuditEntry(entry)}</span>
                    <time dateTime={entry.at}>{formatRelativeDate(entry.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </section>
    </div>
  );
}

function AccessStatus() {
  return (
    <div className="accessShell">
      <main className="accessPanel" aria-live="polite">
        <Loader2 className="spin" size={25} />
        <p>Checking access</p>
      </main>
    </div>
  );
}

function AccessGate({ onSubmit }: { onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await onSubmit(password);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="accessShell">
      <main className="accessPanel">
        <div className="accessHeading">
          <KeyRound size={22} aria-hidden="true" />
          <span className="eyebrow">Raindrop Feed</span>
          <h1>Private library</h1>
        </div>

        <form className="accessForm" onSubmit={submit}>
          <label htmlFor="access-password">Password</label>
          <input
            id="access-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
          {error && <p className="accessError">{error}</p>}
          <button className="accessSubmit" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={17} /> : "Unlock feed"}
          </button>
        </form>
      </main>
    </div>
  );
}

function AccessCheckError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="accessShell">
      <main className="accessPanel errorPanel">
        <p>{message}</p>
        <button className="textButton" type="button" onClick={onRetry}>
          Try again
        </button>
      </main>
    </div>
  );
}

function PeriodSection({
  section,
  expanded,
  collectionNames,
  pendingActions,
  onToggle,
  onToggleRead,
  onDelete,
  onAddLabels,
  onOpenLabels,
  labeling,
  labelError,
}: {
  section: Section;
  expanded: boolean;
  collectionNames: Record<number, string>;
  pendingActions: Record<number, string>;
  onToggle: () => void;
  onToggleRead: (item: RaindropItem) => void;
  onDelete: (item: RaindropItem) => void;
  onAddLabels: (section: Section) => void;
  onOpenLabels: (item: RaindropItem) => void;
  labeling: boolean;
  labelError?: string;
}) {
  const previewItems = expanded ? section.items : section.items.slice(0, 4);
  const hiddenCount = section.items.length - previewItems.length;
  const unlabeledCount = section.items.filter(hasNoLabels).length;

  return (
    <section className="periodSection">
      <div className="periodHeading">
        <button className="periodHeader" type="button" onClick={onToggle} aria-expanded={expanded}>
          <span className="periodTitle">{section.label}</span>
          <span className="periodMeta">
            {section.total} saved / {section.unread} unread
          </span>
          <ChevronDown className={expanded ? "chevron expanded" : "chevron"} size={19} />
        </button>
        {unlabeledCount > 0 && (
          <button
            className="periodLabelAction"
            type="button"
            onClick={() => onAddLabels(section)}
            disabled={labeling}
            aria-label={`Add labels to ${unlabeledCount} unlabeled bookmarks in ${section.label}`}
          >
            {labeling ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            Label {unlabeledCount}
          </button>
        )}
      </div>

      {labelError && (
        <p className="labelError" role="status">
          {labelError}
        </p>
      )}

      <div className={expanded ? "cardGrid expanded" : "cardGrid"}>
        {previewItems.map((item, index) => (
          <BookmarkCard
            key={item._id}
            item={item}
            collectionName={collectionNames[getCollectionId(item)] || "Unsorted"}
            pendingAction={pendingActions[item._id]}
            revealIndex={index}
            onToggleRead={onToggleRead}
            onDelete={onDelete}
            onOpenLabels={onOpenLabels}
          />
        ))}
      </div>

      {!expanded && hiddenCount > 0 && (
        <button className="showAllButton" type="button" onClick={onToggle}>
          Show all ({section.items.length}) <ChevronDown size={16} />
        </button>
      )}
    </section>
  );
}

function BookmarkCard({
  item,
  collectionName,
  pendingAction,
  revealIndex,
  onToggleRead,
  onDelete,
  onOpenLabels,
}: {
  item: RaindropItem;
  collectionName: string;
  pendingAction?: string;
  revealIndex: number;
  onToggleRead: (item: RaindropItem) => void;
  onDelete: (item: RaindropItem) => void;
  onOpenLabels: (item: RaindropItem) => void;
}) {
  const read = isRead(item);
  const title = getItemTitle(item);
  const domain = getDomain(item);
  const favicon = getFaviconUrl(domain);
  const cover = getCoverUrl(item);
  const createdDate = item.created ? new Date(item.created) : undefined;
  const labels = getLabels(item);
  const [coverFailed, setCoverFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
    setFaviconFailed(false);
  }, [cover, domain]);

  return (
    <article
      className={read ? "bookmarkCard read" : "bookmarkCard"}
      style={{ animationDelay: `${Math.min(revealIndex, 8) * 35}ms` }}
    >
      <div className="cardMedia">
        {cover && !coverFailed ? (
          <img src={cover} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
        ) : (
          <div className="coverFallback" aria-hidden="true">
            {!faviconFailed ? (
              <img src={favicon} alt="" onError={() => setFaviconFailed(true)} />
            ) : (
              <span>{domain.slice(0, 1).toUpperCase() || "R"}</span>
            )}
          </div>
        )}

        {!read && createdDate && (
          <span className={getAgeInDays(createdDate) > 30 ? "ageBadge stale" : "ageBadge"}>
            {getAgeLabel(createdDate)}
          </span>
        )}

        <div className="cardActions">
          <a
            className="iconButton cardAction"
            href={item.link || "#"}
            target="_blank"
            rel="noopener"
            aria-label="Open bookmark"
            title="Open bookmark"
          >
            <ExternalLink size={17} />
          </a>
          <button
            className="iconButton cardAction"
            type="button"
            onClick={() => onOpenLabels(item)}
            aria-label="Add a manual label"
            title="Add a manual label"
            disabled={Boolean(pendingAction)}
          >
            <Tag size={17} />
          </button>
          <button
            className="iconButton cardAction"
            type="button"
            onClick={() => onToggleRead(item)}
            aria-label={read ? "Mark unread" : "Mark read"}
            title={read ? "Mark unread" : "Mark read"}
            disabled={Boolean(pendingAction)}
          >
            {pendingAction === "read" ? (
              <Loader2 className="spin" size={17} />
            ) : read ? (
              <EyeOff size={17} />
            ) : (
              <Eye size={17} />
            )}
          </button>
          <button
            className="iconButton cardAction danger"
            type="button"
            onClick={() => onDelete(item)}
            aria-label="Delete bookmark"
            title="Delete bookmark"
            disabled={Boolean(pendingAction)}
          >
            {pendingAction === "delete" ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}
          </button>
        </div>
      </div>

      <div className="cardBody">
        <h2>{title}</h2>
        {labels.length > 0 && (
          <ul className="cardLabels" aria-label="Bookmark labels">
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
        <footer className="cardFooter">
          <SourceIcon domain={domain} />
          <span className="folderLine">
            <Folder size={13} aria-hidden="true" />
            <span>{collectionName}</span>
          </span>
          <span>{domain}</span>
          {createdDate && (
            <time dateTime={item.created} title={createdDate.toLocaleString()}>
              {formatShortDate(createdDate)}
            </time>
          )}
        </footer>
      </div>
    </article>
  );
}

function BookmarkLabelDialog({
  item,
  onClose,
  onSave,
  onRemove,
}: {
  item: RaindropItem;
  onClose: () => void;
  onSave: (item: RaindropItem, label: string) => Promise<void>;
  onRemove: (item: RaindropItem, label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingLabel, setRemovingLabel] = useState("");
  const labels = getLabels(item);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await onSave(item, label);
      onClose();
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function removeLabel(currentLabel: string) {
    setRemovingLabel(currentLabel);
    setError("");

    try {
      await onRemove(item, currentLabel);
    } catch (caught) {
      setError(getReadableError(caught));
    } finally {
      setRemovingLabel("");
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="agentDialog labelDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <div>
            <span className="eyebrow">Bookmark labels</span>
            <h2 id="label-dialog-title">{getItemTitle(item)}</h2>
          </div>
          <button className="iconButton soft" type="button" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </header>

        <form className="labelDialogBody" onSubmit={submit}>
          {labels.length > 0 && (
            <ul className="dialogLabels" aria-label="Current labels">
              {labels.map((currentLabel) => (
                <li key={currentLabel}>
                  <button
                    type="button"
                    onClick={() => void removeLabel(currentLabel)}
                    disabled={saving || Boolean(removingLabel)}
                    aria-label={`Remove ${currentLabel} label`}
                    title={`Remove ${currentLabel}`}
                  >
                    <span>{currentLabel}</span>
                    {removingLabel === currentLabel ? <Loader2 className="spin" size={13} /> : <X size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="manual-label">Add label</label>
          <div className="labelForm">
            <input
              id="manual-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={40}
              autoFocus
              required
            />
            <button className="dialogAction" type="submit" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Tag size={16} />}
              Add
            </button>
          </div>
          {error && <p className="agentError">{error}</p>}
        </form>
      </section>
    </div>
  );
}

function SourceIcon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [domain]);

  if (failed) {
    return <span className="sourceDot" aria-hidden="true" />;
  }

  return <img className="sourceIcon" src={getFaviconUrl(domain)} alt="" onError={() => setFailed(true)} />;
}

function LoadingState({ progress }: { progress: { loaded: number; total?: number } }) {
  return (
    <div className="statePanel">
      <Loader2 className="spin" size={28} />
      <p>
        Loading {progress.loaded > 0 ? `${progress.loaded}${progress.total ? ` of ${progress.total}` : ""}` : "feed"}
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="statePanel errorPanel">
      <p>{message}</p>
      <button className="textButton" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="statePanel">
      <p>No saved links yet.</p>
    </div>
  );
}

function SearchEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="statePanel">
      <p>No bookmarks match this search.</p>
      <button className="textButton" type="button" onClick={onClear}>
        Clear search
      </button>
    </div>
  );
}

async function fetchAllRaindrops(onProgress: (loaded: number, total?: number) => void) {
  const perPage = 50;
  const allItems: RaindropItem[] = [];
  let page = 0;
  let total: number | undefined;

  while (true) {
    const data = await apiJson<RaindropListResponse>(
      `/raindrops/0?perpage=${perPage}&page=${page}&sort=-created`,
    );
    const pageItems = data.items || [];

    allItems.push(...pageItems);
    total = data.count ?? total;
    onProgress(allItems.length, total);

    if (pageItems.length < perPage || (typeof total === "number" && allItems.length >= total)) {
      break;
    }

    page += 1;
  }

  return allItems;
}

async function getAccessSession(): Promise<AccessSession> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new ApiError("The access service is unavailable. Run with Vercel's API runtime.", response.status);
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok || !payload || typeof payload !== "object") {
    throw new ApiError("Could not check access.", response.status);
  }

  return payload as AccessSession;
}

async function startAccessSession(password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "Could not sign in.";

    throw new ApiError(message, response.status);
  }
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";

  if (response.status === 204) {
    return undefined as T;
  }

  if (!contentType.includes("application/json")) {
    throw new ApiError(
      "The Raindrop proxy did not return JSON. Run with Vercel's API runtime and set RAINDROP_TOKEN server-side.",
      response.status,
    );
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}.`;

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

async function agentKeyJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}.`;

    throw new ApiError(message, response.status);
  }

  return payload as T;
}

function buildCollectionMap(responses: CollectionResponse[]) {
  const map: Record<number, string> = {};

  for (const response of responses) {
    flattenCollections(response.items || [], map);
  }

  return map;
}

function flattenCollections(collections: CollectionItem[], map: Record<number, string>) {
  for (const collection of collections) {
    const id = collection._id ?? collection.id;

    if (typeof id === "number" && collection.title) {
      map[id] = collection.title;
    }

    if (collection.children) {
      flattenCollections(collection.children, map);
    }

    if (collection.items) {
      flattenCollections(collection.items, map);
    }
  }
}

function groupIntoSections(items: RaindropItem[], grain: Grain): Section[] {
  const groups = new Map<string, Section>();
  const sorted = [...items].sort((left, right) => getCreatedTime(right) - getCreatedTime(left));

  for (const item of sorted) {
    const created = item.created ? new Date(item.created) : new Date(0);
    const start = getPeriodStart(created, grain);
    const key = getPeriodKey(start, grain);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      existing.total += 1;
      existing.unread += isRead(item) ? 0 : 1;
      continue;
    }

    groups.set(key, {
      key,
      start,
      label: getPeriodLabel(start, grain),
      total: 1,
      unread: isRead(item) ? 0 : 1,
      items: [item],
    });
  }

  return [...groups.values()].sort((left, right) => right.start.getTime() - left.start.getTime());
}

function getPeriodStart(date: Date, grain: Grain) {
  if (grain === "day") {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  if (grain === "month") {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() + mondayOffset);
  return monday;
}

function getPeriodKey(date: Date, grain: Grain) {
  if (grain === "month") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  return `${grain}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getPeriodLabel(start: Date, grain: Grain) {
  if (grain === "month") {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  if (grain === "day") {
    return start.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const startLabel = start.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(start.getFullYear() !== end.getFullYear() ? { year: "numeric" } : {}),
  });
  const endLabel = end.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${startLabel} - ${endLabel}`;
}

function getItemTitle(item: RaindropItem) {
  return item.title?.trim() || item.excerpt?.trim() || getDomain(item) || "(untitled)";
}

function getCreatedTime(item: RaindropItem) {
  return item.created ? new Date(item.created).getTime() : 0;
}

function getCollectionId(item: RaindropItem) {
  if (typeof item.collectionId === "number") {
    return item.collectionId;
  }

  return item.collectionId?.$id || item.collectionId?.oid || 0;
}

function getDomain(item: RaindropItem) {
  if (item.domain) {
    return item.domain.replace(/^www\./, "");
  }

  try {
    return item.link ? new URL(item.link).hostname.replace(/^www\./, "") : "unknown";
  } catch {
    return "unknown";
  }
}

function getCoverUrl(item: RaindropItem) {
  return typeof item.cover === "string" && item.cover.trim().length > 0 ? item.cover : "";
}

function getFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function isRead(item: RaindropItem) {
  return Boolean(item.tags?.some((tag) => tag.toLowerCase() === "read"));
}

function mergeReadTag(tags: string[], shouldRead: boolean) {
  const normalized = tags.filter((tag) => tag.toLowerCase() !== "read");
  return shouldRead ? [...normalized, "read"] : normalized;
}

function getLabels(item: RaindropItem) {
  return (item.tags || []).filter((tag) => tag.trim() && tag.trim().toLocaleLowerCase() !== "read");
}

function filterItems(items: RaindropItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
    const title = getItemTitle(item).toLocaleLowerCase();
    return title.includes(normalizedQuery) || getLabels(item).some((label) => label.toLocaleLowerCase().includes(normalizedQuery));
  });
}

function hasNoLabels(item: RaindropItem) {
  return getLabels(item).length === 0;
}

function normalizeManualLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 40);
}

function appendLabel(tags: string[], label: string) {
  return tags.some((tag) => tag.toLocaleLowerCase() === label) ? tags : [...tags, label];
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function patchItemTags(items: RaindropItem[], itemId: number, tags: string[]) {
  return items.map((item) => (item._id === itemId ? { ...item, tags } : item));
}

function omitKey<T>(record: Record<number, T>, key: number) {
  const next = { ...record };
  delete next[key];
  return next;
}

function getAgeInDays(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.floor((todayStart - start) / 86400000));
}

function getAgeLabel(date: Date) {
  const days = getAgeInDays(date);

  if (days === 0) {
    return "saved today";
  }

  if (days === 1) {
    return "saved yesterday";
  }

  return `saved ${days} days ago`;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== currentYear ? { year: "numeric" } : {}),
  });
}

function formatRelativeDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  const elapsed = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function formatAuditEntry(entry: AgentAuditEntry) {
  if (entry.type === "write") {
    return entry.action === "move_bookmark"
      ? `Moved bookmark ${entry.bookmarkId} to collection ${entry.collectionId}`
      : `Updated tags on bookmark ${entry.bookmarkId}`;
  }

  if (entry.type === "read") {
    return `Read ${entry.endpoint || "feed data"}`;
  }

  if (entry.type === "revoked") {
    return "Link revoked";
  }

  return "Agent request";
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function readCurrentTheme(): Theme {
  if (typeof document !== "undefined") {
    const existing = document.documentElement.dataset.theme;

    if (existing === "dark" || existing === "light") {
      return existing;
    }
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function getReadableError(caught: unknown) {
  if (caught instanceof ApiError) {
    return caught.message;
  }

  if (caught instanceof Error) {
    return caught.message;
  }

  return "Something went wrong.";
}
