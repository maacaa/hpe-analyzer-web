/* Hardware Health redesigned view — mounts the ported 3D chassis engine
 * (chassis-engine.js) onto a React-owned host node. */
import { useEffect, useRef } from "react";
import type { Summary } from "../types";
import {
  setChassisModel,
  mountChassis,
  closeDetail,
  hideTip,
} from "../chassis-engine.js";

export function HardwareView({ summary }: { summary: Summary }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setChassisModel({
      hardware: summary.hardware,
      meta: summary.meta as Record<string, unknown>,
    });
    mountChassis(hostRef.current);
    return () => {
      closeDetail();
      hideTip();
    };
  }, [summary]);

  return <div ref={hostRef} />;
}
