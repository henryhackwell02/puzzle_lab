import "./globals.css";

export const metadata = {
  title: "Puzzle Lab — Build & Share Word Games",
  description: "Create and share custom Connections, Wordle, Strands and Threads puzzles with friends.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
