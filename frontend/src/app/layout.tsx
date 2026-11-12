import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SyncManager } from "@/components/SyncManager";

export const metadata: Metadata = {
  title: "MGA: know exactly what stands between you and the job",
  description: "Skill-by-skill gap analysis between you, a job, and the whole job market. With a learning plan to close it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <Footer />
        <SyncManager />
      </body>
    </html>
  );
}
