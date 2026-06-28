'use client';

import { useEffect, useMemo, useState } from 'react';

interface TeamLogoProps {
  logoUrl?: string | null;
  name?: string | null;
  shortName?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-lg',
};

function normalizeLogoUrl(url?: string | null): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  // Supabase / external absolute URL
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Protocol-relative URL
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  // Static public path cleanup
  if (trimmed.startsWith('/public/team-logos/')) {
    return trimmed.replace('/public/team-logos/', '/team-logos/');
  }

  if (trimmed.startsWith('public/team-logos/')) {
    return `/${trimmed.replace('public/team-logos/', 'team-logos/')}`;
  }

  if (trimmed.startsWith('team-logos/')) {
    return `/${trimmed}`;
  }

  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }

  return trimmed;
}

function getInitials(name?: string | null, shortName?: string | null): string {
  const displayName = shortName || name;
  if (!displayName) return '?';

  return displayName
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

export function TeamLogo({
  logoUrl,
  name,
  shortName,
  size = 'md',
  className = '',
}: TeamLogoProps) {
  const [hasImageError, setHasImageError] = useState(false);

  const normalizedLogoUrl = useMemo(() => normalizeLogoUrl(logoUrl), [logoUrl]);
  const initials = useMemo(() => getInitials(name, shortName), [name, shortName]);

  // Reset error when logo URL changes
  useEffect(() => {
    setHasImageError(false);
  }, [normalizedLogoUrl]);

  const shouldShowImage = normalizedLogoUrl && !hasImageError;

  return (
    <div
      className={`${sizeMap[size]} rounded-full overflow-hidden flex-shrink-0 bg-blue-100 flex items-center justify-center font-bold text-blue-600 ${className}`}
      title={normalizedLogoUrl || undefined}
    >
      {shouldShowImage ? (
        <img
          src={normalizedLogoUrl}
          alt={name || shortName || 'Team logo'}
          className="w-full h-full object-cover"
          onError={() => {
            console.warn('[TEAM_LOGO] Failed to load logo:', {
              original: logoUrl,
              normalized: normalizedLogoUrl,
              team: name || shortName || 'unknown',
            });
            setHasImageError(true);
          }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
