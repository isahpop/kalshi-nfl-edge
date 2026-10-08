import './globals.css';

export const metadata = {
  title: 'NFL Edge Lab | Kalshi Market Research',
  description: 'Read-only NFL prediction-market scanner with probabilistic valuation, quarter-Kelly sizing, and paper trading.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
