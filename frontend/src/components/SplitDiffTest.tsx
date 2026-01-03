import { SplitDiff } from './SplitDiff'

// Test component for SplitDiff single-line comparison
const SplitDiffTest = () => {
  // Test cases for SplitDiff component
  const testCases = [
    // Single line difference test cases
    {
      name: 'Single word change',
      oldValue: 'test',
      newValue: 'test1'
    },
    {
      name: 'Multiple word change',
      oldValue: 'Hello world',
      newValue: 'Hello there'
    },
    {
      name: 'Addition only',
      oldValue: 'test',
      newValue: 'test with addition'
    },
    {
      name: 'Deletion only',
      oldValue: 'test with deletion',
      newValue: 'test'
    },
    {
      name: 'Exact match',
      oldValue: 'same content',
      newValue: 'same content'
    },
    {
      name: 'Empty lines',
      oldValue: '',
      newValue: 'new content'
    },
    
    // JSON format test cases
    {
      name: 'JSON simple object change',
      oldValue: JSON.stringify({ name: 'test', value: 123 }, null, 2),
      newValue: JSON.stringify({ name: 'test1', value: 456 }, null, 2)
    },
    {
      name: 'JSON nested structure',
      oldValue: JSON.stringify({ 
        user: { name: 'Alice', age: 30 }, 
        settings: { theme: 'dark', notifications: true } 
      }, null, 2),
      newValue: JSON.stringify({ 
        user: { name: 'Bob', age: 35 }, 
        settings: { theme: 'light', notifications: true, language: 'en' } 
      }, null, 2)
    },
    {
      name: 'JSON array modification',
      oldValue: JSON.stringify({ items: ['a', 'b', 'c'] }, null, 2),
      newValue: JSON.stringify({ items: ['a', 'd', 'c', 'e'] }, null, 2)
    },
    
    // YAML format test cases
    {
      name: 'YAML simple configuration',
      oldValue: `name: test
version: 1.0
enabled: true`,
      newValue: `name: test1
version: 2.0
enabled: false`
    },
    {
      name: 'YAML nested structure',
      oldValue: `server:
  host: localhost
  port: 8080
database:
  type: mysql
  name: test_db`,
      newValue: `server:
  host: 0.0.0.0
  port: 8081
database:
  type: postgres
  name: new_db`
    },
    {
      name: 'YAML list modification',
      oldValue: `users:
  - name: Alice
    role: admin
  - name: Bob
    role: user`,
      newValue: `users:
  - name: Alice
    role: admin
  - name: Charlie
    role: user
  - name: Dave
    role: guest`
    },
    
    // Misaligned (错行) difference test cases
    {
      name: 'Misaligned - single line insertion',
      oldValue: `line 1
line 2
line 3
line 4`,
      newValue: `line 1
inserted line
line 2
line 3
line 4`
    },
    {
      name: 'Misaligned - single line deletion',
      oldValue: `line 1
line to delete
line 2
line 3
line 4`,
      newValue: `line 1
line 2
line 3
line 4`
    },
    {
      name: 'Misaligned - multiple insertions',
      oldValue: `line 1
line 2
line 3
line 4`,
      newValue: `line 1
insert 1
insert 2
line 2
line 3
insert 3
line 4`
    },
    {
      name: 'Misaligned - mixed insert/delete',
      oldValue: `line 1
line 2
line 3
line 4
line 5`,
      newValue: `line 1
inserted line
line 3
line 4
changed line 5`
    },
    {
      name: 'Misaligned - complex changes',
      oldValue: `header
section 1
  item 1
  item 2
section 2
  item A
  item B`,
      newValue: `header
new section
  new item
section 1
  item 1
  modified item 2
section 2
  item B`
    }
  ]

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">SplitDiff Comprehensive Test</h1>
      {testCases.map((test, index) => (
        <div key={index} className="mb-8 p-4 border rounded">
          <h2 className="text-xl font-semibold mb-2">{test.name}</h2>
          <div className="h-48 overflow-auto">
            <SplitDiff oldValue={test.oldValue} newValue={test.newValue} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default SplitDiffTest