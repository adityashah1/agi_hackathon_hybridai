"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

interface MockAppLinkProps {
  className?: string;
  label: string;
  /** Path under the mock apps server root, e.g. inbox/. */
  path: string;
  port: number;
}

/**
 * Opens a mock app on whatever host is serving the panel, so the link works
 * from a teammate's device on the same network as well as from this machine.
 */
export const MockAppLink = ({
  path,
  port,
  label,
  className,
}: MockAppLinkProps) => {
  const [href, setHref] = useState(`http://localhost:${port}/${path}`);
  useEffect(() => {
    setHref(
      `${window.location.protocol}//${window.location.hostname}:${port}/${path}`
    );
  }, [path, port]);
  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {label}
      <ExternalLinkIcon className="ml-1 inline size-3 align-[-1px]" />
    </a>
  );
};
