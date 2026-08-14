import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'NextLeap Property Scout',
  description: 'Voice-first AI property scout for Bengaluru renters',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
