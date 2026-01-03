import { diffWords } from 'diff'

interface WordDiffProps {
  oldValue: string
  newValue: string
  className?: string
}

export function WordDiff({ oldValue, newValue, className = '' }: WordDiffProps) {
  const differences = diffWords(oldValue, newValue)

  return (
    <div className={`font-mono text-sm whitespace-pre-wrap break-all ${className}`}>
      {differences.map((part, index) => {
        if (part.added) {
          return (
            <span
              key={index}
              className="bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 px-0.5 rounded"
            >
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span
              key={index}
              className="bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100 px-0.5 rounded line-through decoration-red-500/50"
            >
              {part.value}
            </span>
          )
        }
        return (
          <span key={index} className="text-gray-700 dark:text-gray-300">
            {part.value}
          </span>
        )
      })}
    </div>
  )
}
