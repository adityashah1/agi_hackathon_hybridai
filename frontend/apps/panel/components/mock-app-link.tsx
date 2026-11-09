"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

interface MockAppLinkProps {
  /**
   * Absolute base the apps are served from (MOCK_BASE), when the panel knows
   * one. Without it the link points at `port` on the host serving the panel.
   */
  base?: string | null;
  className?: string;
  label: string;
  /** Path under the mock apps server root, e.g. inbox/. */
  path: string;
  port: number;
}

/**
 * Opens a mock app. With MOCK_BASE set (a deployed copy of mock_apps/) the
 * link goes there; otherwise it uses whatever host is serving the panel, so
 * it works from a teammate's device on the same network as well as from
 * this machine.
 */
export const MockAppLink = ({
  base,
  path,
  port,
  label,
  className,
}: MockAppLinkProps) => {
  const [href, setHref] = useState(
    base ? `${base}/${path}` : `http://localhost:${port}/${path}`
  );
  useEffect(() => {
    if (base) {
      setHref(`${base}/${path}`);
      return;
    }
    setHref(
      `${window.location.protocol}//${window.location.hostname}:${port}/${path}`
    );
  }, [base, path, port]);
  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {label}
      <ExternalLinkIcon className="ml-1 inline size-3 align-[-1px]" />
    </a>
  );
};
