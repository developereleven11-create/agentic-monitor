export const metadata = { title: 'Monitoring Dashboard' };
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <div className="max-w-5xl mx-auto p-6">
          <h1 className="text-2xl font-bold mb-6">Shopify WatchDog</h1>
          {children}
        </div>
      </body>
    </html>
  );
}
