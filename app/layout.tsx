import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pocket TTS Lab",
  description: "Run, feel, and measure Kyutai Pocket TTS locally on CPU.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
