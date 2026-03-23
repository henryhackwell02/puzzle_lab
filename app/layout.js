import "./globals.css";

export const metadata = {
  title: "Puzzle Lab — Build & Share Word Games",
  description: "Create and share custom Connections, Wordle, Strands and Threads puzzles with friends.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
