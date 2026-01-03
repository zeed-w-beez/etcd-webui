import { diffLines, diffWordsWithSpace } from 'diff'

interface SplitDiffProps {
  oldValue: string
  newValue: string
  className?: string
}

interface LineInfo {
  text: string
  type: 'normal' | 'removed' | 'added' | 'empty'
  lineNumber: number
  isChange: boolean
}

interface WordPart {
  text: string
  type: 'normal' | 'removed' | 'added'
}

// Function to generate word-level diff parts with improved empty line handling
const getWordDiffParts = (oldText: string, newText: string): { oldParts: WordPart[], newParts: WordPart[] } => {
  // Handle empty lines specially
  if (oldText === '' && newText === '') {
    return { 
      oldParts: [{ text: '', type: 'normal' }], 
      newParts: [{ text: '', type: 'normal' }] 
    }
  }
  
  if (oldText === '') {
    return { 
      oldParts: [{ text: '', type: 'normal' }], 
      newParts: diffWordsWithSpace('', newText).map(part => ({
        text: part.value,
        type: part.added ? 'added' : 'normal'
      })) 
    }
  }
  
  if (newText === '') {
    return { 
      oldParts: diffWordsWithSpace(oldText, '').map(part => ({
        text: part.value,
        type: part.removed ? 'removed' : 'normal'
      })), 
      newParts: [{ text: '', type: 'normal' }] 
    }
  }
  
  // Normal word diff for non-empty lines
  const differences = diffWordsWithSpace(oldText, newText)
  const oldParts: WordPart[] = []
  const newParts: WordPart[] = []

  differences.forEach(part => {
    if (part.removed) {
      oldParts.push({ text: part.value, type: 'removed' })
    } else if (part.added) {
      newParts.push({ text: part.value, type: 'added' })
    } else {
      oldParts.push({ text: part.value, type: 'normal' })
      newParts.push({ text: part.value, type: 'normal' })
    }
  })

  return { oldParts, newParts }
}

export function SplitDiff({ oldValue, newValue, className = '' }: SplitDiffProps) {
  const leftLines: LineInfo[] = []
  const rightLines: LineInfo[] = []
  
  let leftLineNum = 1
  let rightLineNum = 1
  
  // Helper function to calculate similarity between two lines
  // Enhanced with token-based and character-based comparison for better accuracy
  const calculateSimilarity = (a: string, b: string): number => {
    if (a === b) return 1.0
    if (!a || !b) return 0.0
    
    // For very short texts (single token), use character-based similarity
    if (a.trim().split(/\s+/).length === 1 && b.trim().split(/\s+/).length === 1) {
      // Calculate Levenshtein distance ratio for short single-token lines
      const maxLength = Math.max(a.length, b.length)
      if (maxLength === 0) return 1.0
      
      // Simple character overlap ratio for better single-token matching
      const aChars = new Set(a)
      const bChars = new Set(b)
      let intersection = 0
      aChars.forEach(char => {
        if (bChars.has(char)) intersection++
      })
      const union = aChars.size + bChars.size - intersection
      return intersection / union
    }
    
    // Tokenize lines into words for better similarity assessment
    const aTokens = a.trim().split(/\s+/).filter(token => token.length > 0)
    const bTokens = b.trim().split(/\s+/).filter(token => token.length > 0)
    
    if (aTokens.length === 0 && bTokens.length === 0) return 1.0
    if (aTokens.length === 0 || bTokens.length === 0) return 0.0
    
    // Calculate Jaccard similarity (intersection over union)
    const aSet = new Set(aTokens)
    const bSet = new Set(bTokens)
    
    let intersection = 0
    aSet.forEach(token => {
      if (bSet.has(token)) intersection++
    })
    
    const union = aSet.size + bSet.size - intersection
    return intersection / union
  }
  
  // Helper function to check if two changes should be in the same group
  const shouldGroupChanges = (prevChange: any, currChange: any): boolean => {
    if (!prevChange) return false
    
    // Group adjacent add/remove operations
    if (prevChange.added && currChange.removed) return true
    if (prevChange.removed && currChange.added) return true
    
    // Group consecutive same-type changes
    if (prevChange.added && currChange.added) return true
    if (prevChange.removed && currChange.removed) return true
    
    return false
  }
  
  // Use diffLines to get initial line-level changes
  const differences = diffLines(oldValue || '', newValue || '')
  
  // Process changes with improved grouping and alignment
  let currentGroup: { oldLines: LineInfo[], newLines: LineInfo[] } | null = null
  
  const startNewGroup = () => {
    if (currentGroup) {
      processGroup(currentGroup)
    }
    currentGroup = { oldLines: [], newLines: [] }
  }
  
  const processGroup = (group: { oldLines: LineInfo[], newLines: LineInfo[] }) => {
    const { oldLines, newLines } = group
    
    // If both sides have content, try to find optimal alignment based on similarity
    if (oldLines.length > 0 && newLines.length > 0) {
      // Create similarity matrix
      const similarityMatrix: number[][] = []
      for (let i = 0; i < oldLines.length; i++) {
        similarityMatrix[i] = []
        for (let j = 0; j < newLines.length; j++) {
          similarityMatrix[i][j] = calculateSimilarity(oldLines[i].text, newLines[j].text)
        }
      }
      
      // Find optimal alignment using greedy approach
      const alignedOldLines: LineInfo[] = []
      const alignedNewLines: LineInfo[] = []
      const usedNewLines = new Set<number>()
      
      // First match lines with high similarity
      for (let i = 0; i < oldLines.length; i++) {
        let bestMatch = -1
        let bestScore = 0.1 // Minimum similarity threshold - lowered for better single-line matching
        
        for (let j = 0; j < newLines.length; j++) {
          if (!usedNewLines.has(j) && similarityMatrix[i][j] > bestScore) {
            bestScore = similarityMatrix[i][j]
            bestMatch = j
          }
        }
        
        if (bestMatch !== -1) {
          alignedOldLines.push(oldLines[i])
          alignedNewLines.push(newLines[bestMatch])
          usedNewLines.add(bestMatch)
        }
      }
      
      // Add remaining lines with empty placeholders
      for (let i = 0; i < oldLines.length; i++) {
        if (!alignedOldLines.includes(oldLines[i])) {
          alignedOldLines.push(oldLines[i])
          alignedNewLines.push({
            text: '',
            type: 'empty',
            lineNumber: 0,
            isChange: true
          })
        }
      }
      
      for (let j = 0; j < newLines.length; j++) {
        if (!usedNewLines.has(j)) {
          alignedOldLines.push({
            text: '',
            type: 'empty',
            lineNumber: 0,
            isChange: true
          })
          alignedNewLines.push(newLines[j])
        }
      }
      
      // Append aligned lines
      leftLines.push(...alignedOldLines)
      rightLines.push(...alignedNewLines)
    } else {
      // Simple alignment for add-only or remove-only changes
      const maxLen = Math.max(oldLines.length, newLines.length)
      const alignedOldLines = [...oldLines]
      const alignedNewLines = [...newLines]
      
      while (alignedOldLines.length < maxLen) {
        alignedOldLines.push({
          text: '',
          type: 'empty',
          lineNumber: 0,
          isChange: true
        })
      }
      
      while (alignedNewLines.length < maxLen) {
        alignedNewLines.push({
          text: '',
          type: 'empty',
          lineNumber: 0,
          isChange: true
        })
      }
      
      // Append aligned lines
      leftLines.push(...alignedOldLines)
      rightLines.push(...alignedNewLines)
    }
  }
  
  let prevChange: any = null
  
  differences.forEach(change => {
    const lines = change.value.split('\n').filter((_, index, arr) => index < arr.length - 1 || arr.length === 1) // Keep content when it's a single line without newline
    
    if (change.added || change.removed) {
      // Check if we should start a new group or continue the current one
      if (!currentGroup || !shouldGroupChanges(prevChange, change)) {
        startNewGroup()
      }
      
      if (change.removed) {
        lines.forEach(line => {
          currentGroup!.oldLines.push({
            text: line,
            type: 'removed',
            lineNumber: leftLineNum++,
            isChange: true
          })
        })
      } else if (change.added) {
        lines.forEach(line => {
          currentGroup!.newLines.push({
            text: line,
            type: 'added',
            lineNumber: rightLineNum++,
            isChange: true
          })
        })
      }
    } else {
      // Process unchanged lines, flushing any current group first
      if (currentGroup) {
        processGroup(currentGroup)
        currentGroup = null
      }
      
      lines.forEach(line => {
        leftLines.push({
          text: line,
          type: 'normal',
          lineNumber: leftLineNum++,
          isChange: false
        })
        rightLines.push({
          text: line,
          type: 'normal',
          lineNumber: rightLineNum++,
          isChange: false
        })
      })
    }
    
    prevChange = change
  })
  
  // Process any remaining group
  if (currentGroup) {
    processGroup(currentGroup)
  }
  
  // Ensure both sides have the same length
  const maxLines = Math.max(leftLines.length, rightLines.length)
  while (leftLines.length < maxLines) {
    leftLines.push({ text: '', type: 'empty', lineNumber: 0, isChange: false })
  }
  while (rightLines.length < maxLines) {
    rightLines.push({ text: '', type: 'empty', lineNumber: 0, isChange: false })
  }

  return (
    <div className={`font-mono text-sm overflow-auto ${className}`}>
      <table className="w-full border-collapse min-w-full">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800 border-b">
            <th className="w-14 text-center text-xs text-gray-500 py-2 border-r select-none">Old</th>
            <th className="flex-1 text-center text-xs text-gray-500 py-2 border-r select-none">Content</th>
            <th className="w-14 text-center text-xs text-gray-500 py-2 select-none">New</th>
            <th className="flex-1 text-center text-xs text-gray-500 py-2 select-none">Content</th>
          </tr>
        </thead>
        <tbody>
          {leftLines.map((left, index) => {
            const right = rightLines[index] || { text: '', type: 'empty', lineNumber: 0, isChange: false }
            
            const isRemoved = left.type === 'removed'
            const isAdded = right.type === 'added'
            const isChanged = isRemoved || isAdded

            // Get word-level diff parts for current lines
            const { oldParts, newParts } = getWordDiffParts(left.text, right.text)
            
            return (
              <tr key={index}>
                {/* Left Line Number */}
                <td 
                  className={`border-r align-top p-0 leading-5 w-14 font-mono ${ 
                    isRemoved 
                      ? 'bg-red-50 dark:bg-red-950/30' 
                      : isChanged 
                      ? 'bg-gray-50 dark:bg-gray-950/20' 
                      : 'bg-gray-50 dark:bg-gray-950/10' 
                  }`}
                >
                  <div className="px-3 py-0.5 min-h-[1.25rem] text-right text-gray-400 text-xs select-none">
                    {left.lineNumber || ''}
                  </div>
                </td>

                {/* Left Content */}
                <td 
                  className={`border-r align-top p-0 leading-5 ${ 
                    isRemoved 
                      ? 'bg-red-50 dark:bg-red-950/30' 
                      : isChanged 
                      ? 'bg-gray-50 dark:bg-gray-950/20' 
                      : 'bg-white dark:bg-gray-900' 
                  }`}
                >
                  <div className="px-3 py-0.5 min-h-[1.25rem] whitespace-pre-wrap break-all">
                    {left.text ? (
                      <span className={`${isRemoved ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
                        {oldParts.map((part, partIndex) => (
                          <span 
                            key={partIndex} 
                            className={part.type === 'removed' ? 'bg-red-200 dark:bg-red-800/50' : ''}
                          >
                            {part.text}
                          </span>
                        ))}
                      </span>
                    ) : ''}
                  </div>
                </td>

                {/* Right Line Number */}
                <td 
                  className={`border-r align-top p-0 leading-5 w-14 font-mono ${ 
                    isAdded 
                      ? 'bg-green-50 dark:bg-green-950/30' 
                      : isChanged 
                      ? 'bg-gray-50 dark:bg-gray-950/20' 
                      : 'bg-gray-50 dark:bg-gray-950/10' 
                  }`}
                >
                  <div className="px-3 py-0.5 min-h-[1.25rem] text-right text-gray-400 text-xs select-none">
                    {right.lineNumber || ''}
                  </div>
                </td>

                {/* Right Content */}
                <td 
                  className={`align-top p-0 leading-5 ${ 
                    isAdded 
                      ? 'bg-green-50 dark:bg-green-950/30' 
                      : isChanged 
                      ? 'bg-gray-50 dark:bg-gray-950/20' 
                      : 'bg-white dark:bg-gray-900' 
                  }`}
                >
                  <div className="px-3 py-0.5 min-h-[1.25rem] whitespace-pre-wrap break-all">
                    {right.text ? (
                      <span className={`${isAdded ? 'text-green-700 dark:text-green-300' : 'text-gray-700 dark:text-gray-300'}`}>
                        {newParts.map((part, partIndex) => (
                          <span 
                            key={partIndex} 
                            className={part.type === 'added' ? 'bg-green-200 dark:bg-green-800/50' : ''}
                          >
                            {part.text}
                          </span>
                        ))}
                      </span>
                    ) : ''}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
