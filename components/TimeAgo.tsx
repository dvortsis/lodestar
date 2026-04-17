"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useMemo } from "react";

dayjs.extend(relativeTime);

export function TimeAgo({
  unix,
  suppress,
}: {
  unix: number;
  suppress?: boolean;
}) {
  const title = useMemo(
    () => dayjs.unix(unix).format("YYYY-MM-DD HH:mm:ss"),
    [unix],
  );
  if (suppress) {
    return (
      <span className="tabular-nums" title={title}>
        …
      </span>
    );
  }
  return (
    <span className="tabular-nums" title={title}>
      {dayjs.unix(unix).fromNow()}
    </span>
  );
}
