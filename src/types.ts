export type Severity = "critical" | "warning" | "information";

export interface FirmwareEntry {
  component: string;
  version: string;
  displayVersion: string;
  category: string;
  date: string | null;
  format: string;
  description?: string;
  formatNote?: string;
  source: string;
  rawKey?: string;
}

export type HardwareStatus = "healthy" | "warning" | "failed";

/** The exact IML alarm that produced a component's health status. */
export interface HardwareIssue {
  date: string;
  severity: Severity;
  message: string;
}

export interface HardwareEntry {
  type: string;
  id?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  partNumber?: string;
  family?: string;
  speed?: string;
  cores?: string;
  cache?: string;
  stepping?: string;
  memoryType?: string;
  moduleType?: string;
  size?: string;
  slot?: string;
  interface?: string;
  macAddress?: string;
  adapterType?: string;
  firmware?: string;
  capacity?: string;
  controllerType?: string;
  driveType?: string;
  connectedDrives?: string;
  memorySize?: string;
  present?: string;
  redundant?: string;
  sparePartNumber?: string;
  correctable?: string;
  uncorrectable?: string;
  orderNumber?: string;
  buildOfMaterials?: string;
  universalUniqueId?: string;
  assetTag?: string;
  skuNumber?: string;
  totalSystemMemory?: string;
  systemRomVersion?: string;
  iloVersion?: string;
  bmcVersion?: string;
  cpldVersion?: string;
  vendorId?: number;
  deviceId?: number;
  subsystemVendorId?: string;
  subsystemDeviceId?: number;
  driverVersion?: string;
  status?: HardwareStatus;
  issues?: HardwareIssue[];
  source: string;
}

export interface ImlEntry {
  date: string;
  id: number;
  classCode: number;
  eventCode: number;
  logType: "iml" | "iel" | "unknown";
  severity: Severity;
  message: string;
  alarm: string;
  resolution: string | null;
  timestamp: number | null;
  source: string;
}

export interface EventEntry {
  date: string;
  severity: Severity;
  message: string;
  classCode: number;
  eventCode: number;
  timestamp: number | null;
  source: string;
}

export interface AdvisoryResult {
  component: string | null;
  version: string | null;
  affected: boolean;
  label: string;
  fix: string | null;
  name?: string;
}

export interface BugEntry {
  id: string;
  title: string;
  description: string;
  component: string;
  affectedVersions: { min?: string; max?: string };
  fixedIn: string;
  severity: Severity;
  results: AdvisoryResult[];
}

export interface FirmwareAdvisory extends BugEntry {
  resolvesErrorCodes: string[];
}

export interface Playbook {
  meaning: string;
  details?: { label: string; value: string }[];
  steps: string[];
}

export interface RcaEntry {
  title: string;
  components: string[];
  resolution: string | null;
  cause?: string | null;
  symptom?: string | null;
  category?: string | null;
  platforms?: string[] | null;
  playbook?: Playbook | null;
  bugs: BugEntry[];
  severity: Severity;
  classCode: number;
  eventCode: number;
  docUrl: string;
  count: number;
  lastDate: string;
  lastTimestamp: number | null;
}

export interface Stats {
  records: number;
  zbbFiles: number;
  imlCount: number;
  eventCount: number;
  criticalCount: number;
  warningCount: number;
}

export interface Model {
  meta: Record<string, unknown>;
  customerInfo: Record<string, string> | null;
  fileListing: string[];
  clist: string[];
  counters: { id: number; value: number; name: string }[];
  firmware: FirmwareEntry[];
  hardware: HardwareEntry[];
  iml: ImlEntry[];
  events: EventEntry[];
  rca: RcaEntry[];
  advisories: FirmwareAdvisory[];
  stats: Stats;
}

export interface ProgressInfo {
  phase: string;
  done: number;
  total: number;
  pct: number;
}

/** The small, always-in-memory part of the model shipped to the UI (RNF-4). */
export type Summary = Omit<Model, "iml" | "events">;

/** Row shape served by worker queries for the IML / Event Log tabs. */
export interface LogRow {
  date: string;
  severity: Severity;
  message: string;
  alarm: string;
  classCode: number;
  eventCode: number;
}

export interface LogFilter {
  severity: Severity | "all";
  text: string;
}

export interface LogQueryResult {
  rows: LogRow[];
  total: number;
}

export type WorkerRequest =
  | { id: number; type: "analyze"; file: File }
  | { id: number; type: "query"; tab: "iml" | "events"; filter: LogFilter; page: number }
  | { id: number; type: "export" }
  | { id: number; type: "openCached"; fingerprint: string };

export interface AnalyzeResult {
  summary: Summary;
  fingerprint: string;
  fromCache: boolean;
}

/** Worker -> renderer RPC responses. */
export type WorkerResponse =
  | { type: "progress"; progress: ProgressInfo }
  | { id: number; ok: true; type: "analyzed"; result: AnalyzeResult }
  | { id: number; ok: true; type: "query"; result: LogQueryResult }
  | { id: number; ok: true; type: "export"; pdf: Uint8Array }
  | { id: number; ok: false; type: string; error: string };
