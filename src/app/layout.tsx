import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "3D Model Viewer";
const description =
  "Open and share 3D models in the browser — GLB, glTF, OBJ, FBX, STL, PLY and more. Drop a file or paste a link.";

export const metadata: Metadata = {
  title: { default: title, template: "%s · 3D Model Viewer" },
  description,
  applicationName: title,
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0e14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
