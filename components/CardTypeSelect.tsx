'use client';

interface CardTypeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function CardTypeSelect({
  value,
  onChange,
  disabled = false,
}: CardTypeSelectorProps) {
  const cardTypes = [
    { value: 'yellow', label: '🟡 Yellow Card', points: '2 pts (1Y)' },
    { value: 'red', label: '🔴 Red Card', points: '6 pts (Direct Red)' },
    {
      value: 'second_yellow',
      label: '🟨🟨 Second Yellow',
      points: '4 pts (2Y)',
    },
  ];

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-gray-700">
        Card Type
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
      >
        <option value="">Select card type...</option>
        {cardTypes.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label} - {type.points}
          </option>
        ))}
      </select>
    </div>
  );
}
