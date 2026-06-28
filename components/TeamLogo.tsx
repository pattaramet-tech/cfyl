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

export function TeamLogo({
  logoUrl,
  name,
  shortName,
  size = 'md',
  className = '',
}: TeamLogoProps) {
  const getInitials = (): string => {
    const displayName = shortName || name;
    if (!displayName) return '?';
    return displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const initials = getInitials();

  if (logoUrl) {
    return (
      <div className={`${sizeMap[size]} rounded-full overflow-hidden flex-shrink-0 bg-gray-200 flex items-center justify-center ${className}`}>
        <img
          src={logoUrl}
          alt={name || 'Team logo'}
          className="w-full h-full object-cover"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.style.display = 'none';
            const parent = img.parentElement;
            if (parent) {
              const fallback = document.createElement('span');
              fallback.className = 'font-bold text-gray-600';
              fallback.textContent = initials;
              parent.appendChild(fallback);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${sizeMap[size]} rounded-full flex-shrink-0 bg-blue-100 flex items-center justify-center font-bold text-blue-600 ${className}`}>
      {initials}
    </div>
  );
}
