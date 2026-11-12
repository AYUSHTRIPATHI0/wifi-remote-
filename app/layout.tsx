import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "WiFi Smart Remote | by Ayush Tripathi",
  description: "Next-Gen WiFi Smart Remote for PC & Smart TV from your smartphone. Created by Ayush Tripathi (Sitekraft.dev).",
  authors: [{ name: "Ayush Tripathi", url: "https://github.com/AYUSHTRIPATHI0" }],
  creator: "Ayush Tripathi",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Smart Remote",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#090d16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#090d16] text-slate-100 min-h-screen overflow-x-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
