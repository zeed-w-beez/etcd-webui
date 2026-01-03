import { diffWords } from 'diff'

interface WordDiffProps {
  oldValue: string
  newValue: string
  className?: string
}

export function WordDiff({ oldValue, newValue, className = '' }: WordDiffProps) {
  console.log('WordDiff Debug:', { oldValue, newValue, oldLen: oldValue?.length, newLen: newValue?.length })
  
  if (!oldValue && !newValue) {
    console.log('Both values are empty')
    return null
  }
  
  const differences = diffWords(oldValue || '', newValue || '')
  console.log('Diff result:', differences)

  return (
    <div 
      className={`font-mono text-sm whitespace-pre-wrap break-all ${className}`}
      data-testid="word-diff-container"
    >
      {differences.length === 0 ? (
        <span className="text-gray-400 italic">No differences (strings are identical)</span>
      ) : (
        differences.map((part, index) => {
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
        })
      )}
    </div>
  )
}
