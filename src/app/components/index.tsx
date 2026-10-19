import React from 'react';

export interface HeaderProps {
  title: string;
}

export const Header: React.FC<HeaderProps> = ({ title }) => (
  <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
    <div className="flex items-center space-x-2">
      <span className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></span>
      <h1 className="text-lg font-bold tracking-wider text-white uppercase">{title}</h1>
    </div>
    <div className="text-xs px-2.5 py-1 rounded bg-indigo-950/70 text-indigo-300 border border-indigo-800/40">
      M0: Ready
    </div>
  </header>
);
