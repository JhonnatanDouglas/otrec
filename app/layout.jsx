import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'otrec · Garimpe preços em vários marketplaces',
  description: 'Busque ao mesmo tempo na Amazon e no KaBuM!, com categoria, faixa de preço e sem compra internacional.',
};

export const viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F5F2EA' }, { media: '(prefers-color-scheme: dark)', color: '#0F0F14' }],
};

// Aplica o tema salvo antes da pintura para evitar o flash de tema errado.
const themeScript = `try{var t=localStorage.getItem('otrec:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
