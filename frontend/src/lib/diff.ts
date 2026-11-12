export type DiffPart = { text: string; kind: "same" | "added" | "removed" };

/** Word-level diff (LCS) for showing how a resume line was reworded. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push(a[i], "same"); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], "removed");
    else push(b[j++], "added");
  }
  while (i < n) push(a[i++], "removed");
  while (j < m) push(b[j++], "added");
  return out;
}
