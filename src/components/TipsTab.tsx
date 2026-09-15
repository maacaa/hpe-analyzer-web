import type { FirmwareAdvisory, Summary } from "../types";
import { SevBadge } from "./ImlTab";

export function TipsTab({ model }: { model: Summary }) {
  if (model.advisories.length === 0) {
    return (
      <div className="panel">
        <div className="empty">No known firmware advisories for this server.</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Known firmware advisories for this server</h3>
        <span className="muted">
          {model.advisories.length} advisory{model.advisories.length === 1 ? "" : "ies"}
        </span>
      </div>
      <div className="adv-list">
        {model.advisories.map((a) => (
          <AdvisoryCard key={a.id} advisory={a} />
        ))}
      </div>
    </div>
  );
}

function AdvisoryCard({ advisory }: { advisory: FirmwareAdvisory }) {
  return (
    <div className="rca-fix">
      <div className="rca-fix-label">
        <SevBadge sev={advisory.severity} /> Known firmware issue (HPE advisory)
      </div>
      <div className="rca-bug-title">{advisory.title}</div>
      <p className="rca-bug-desc">{advisory.description}</p>
      {advisory.results.map((res, i) => (
        <div
          key={i}
          className={`rca-bug-status ${res.affected ? "affected" : "ok"}`}
        >
          {res.label}
          {res.fix && <div className="rca-bug-fix">{res.fix}</div>}
        </div>
      ))}
    </div>
  );
}