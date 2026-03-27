import type { Metadata } from "next";
import "./globals.css";
import { validateEnv } from "@/lib/env";

// Run env validation once at server startup
validateEnv();

export const metadata: Metadata = {
  title: "TCG Power Dialer",
  description: "AI-powered power dialer for Today Capital Group",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
