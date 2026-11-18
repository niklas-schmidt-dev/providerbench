import type { Metadata } from "next";

import { NotFoundTerminal } from "@/components/premium/not-found-pages/not-found-terminal";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main">
      <NotFoundTerminal project="providerbench" homeHref="/" className="min-h-[560px]" />
    </main>
  );
}
