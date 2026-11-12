import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
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
    <html lang="en" className={`${GeistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col overflow-x-clip">
        <Nav />
        <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-24 pt-10 sm:px-8">{children}</main>
        <Footer />
        <SyncManager />
      </body>
    </html>
  );
}
