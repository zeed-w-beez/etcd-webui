import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Search, Database, ChevronDown, ChevronRight, Server, Sun, Moon, RotateCcw, GitCompare } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { etcdApi, type EtcdKey, type KeyVersionsResponse, type KeyHistoryResponse } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'
import { EtcdToaster } from '@/components/ui/toaster'
import { type TreeItem, keysToTree } from '@/lib/utils'
import { ClusterManager } from './components/ClusterManager'
import { ClusterStatusCard } from './components/ClusterStatusCard'
import { WatchPanel } from './components/WatchPanel'

function App() {
  const [keys, setKeys] = useState<EtcdKey[]>([])
  const [tree, setTree] = useState<TreeItem[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [searchPrefix, setSearchPrefix] = useState('/')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [isAllExpanded, setIsAllExpanded] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  
  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  
  // Form states
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newValueFormat, setNewValueFormat] = useState<'text' | 'json' | 'yaml'>('text')
  const [editValue, setEditValue] = useState('')
  const [editValueFormat, setEditValueFormat] = useState<'text' | 'json' | 'yaml'>('text')
  const [deleteKeyName, setDeleteKeyName] = useState('')
  
  // View state
  type View = 'keys' | 'clusters' | 'watch'
  const [activeView, setActiveView] = useState<View>('keys')
  
  // Edit state for key detail
  const [editedValue, setEditedValue] = useState('')
  const [valueFormat, setValueFormat] = useState<'text' | 'json' | 'yaml'>('text')
  
  // Version history state
  const [keyVersions, setKeyVersions] = useState<KeyVersionsResponse | null>(null)
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false)
  const [leftVersion, setLeftVersion] = useState<number | null>(null)
  const [rightVersion, setRightVersion] = useState<number | null>(null)
  const [leftHistory, setLeftHistory] = useState<KeyHistoryResponse | null>(null)
  const [rightHistory, setRightHistory] = useState<KeyHistoryResponse | null>(null)
  const [compareFormat, setCompareFormat] = useState<'text' | 'json' | 'yaml'>('text')
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  
  // Update editedValue when selectedKey changes
  useEffect(() => {
    if (selectedKeyData) {
      setEditedValue(selectedKeyData.value)
    }
    fetchKeyVersions(selectedKey)
  }, [selectedKey])
  
  const { toast } = useToast()

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode)
  }

  useEffect(() => {
    fetchKeys()
    checkHealth()
    
    const interval = setInterval(checkHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchKeys = async (prefix?: string, limit: number = 100) => {
    setIsLoading(true)
    try {
      const data = await etcdApi.getKeys(prefix, limit)
      const sortedKeys = data.sort((a, b) => a.key.localeCompare(b.key))
      setKeys(sortedKeys)
      setTree(keysToTree(sortedKeys))
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch keys',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const toggleExpand = (path: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedNodes(newExpanded)
  }

  const isExpanded = (path: string) => {
    return expandedNodes.has(path)
  }

  const toggleExpandAll = () => {
    if (isAllExpanded) {
      // 当前全部已展开，则折叠所有
      setExpandedNodes(new Set())
      setIsAllExpanded(false)
    } else {
      // 当前未全部展开，则展开所有
      const allPaths = new Set<string>()
      
      const collectPaths = (node: TreeItem) => {
        if (!node.isLeaf) {
          allPaths.add(node.path)
        }
        node.children.forEach(child => collectPaths(child))
      }
      
      tree.forEach(node => collectPaths(node))
      setExpandedNodes(allPaths)
      setIsAllExpanded(true)
    }
  }

  const renderTreeNode = (node: TreeItem, level: number = 0) => {
    const isNodeExpanded = isExpanded(node.path)

    return (
      <div key={node.key} className="space-y-1 mt-0.5">
        <div
          onClick={() => {
            if (node.isLeaf) {
              setSelectedKey(node.key)
            } else {
              toggleExpand(node.path)
            }
          }}
          className={`flex items-center gap-0.5 p-0.5 rounded-lg cursor-pointer transition-all ${selectedKey === node.key
            ? 'bg-violet-100 dark:bg-violet-900 border-violet-300 dark:border-violet-700 border'
            : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'}
          `}
          style={{ paddingLeft: `${level * 16}px` }}
        >
          {node.isLeaf ? (
            <div className="w-4" />
          ) : isNodeExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
          <span className={`font-medium ${node.isLeaf ? 'text-gray-800 dark:text-gray-200' : 'text-violet-700 dark:text-violet-300'}`}>
            {node.name}
          </span>
          {node.isLeaf && (
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate ml-2">
              {node.value && node.value.length > 20 ? `${node.value.slice(0, 20)}...` : node.value || ''}
            </span>
          )}
        </div>
        {node.children.length > 0 && isNodeExpanded && (
          <div>
            {node.children.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    )
  }

  const checkHealth = async () => {
    try {
      const status = await etcdApi.checkHealth()
      setIsConnected(status.status === 'healthy')
    } catch {
      setIsConnected(false)
    }
  }

  const handleSearch = () => {
    fetchKeys(searchPrefix)
  }

  const handleAddKey = async () => {
    if (!newKey.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Key is required',
      })
      return
    }

    try {
      await etcdApi.createKey(newKey.trim(), newValue)
      
      toast({
        title: 'Success',
        description: 'Key created successfully',
      })
      setIsAddDialogOpen(false)
      setNewKey('')
      setNewValue('')
      fetchKeys(searchPrefix)
      setSelectedKey(newKey.trim())
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      })
    }
  }

  const handleEditKey = async () => {
    if (!selectedKey) return
    
    try {
      await etcdApi.updateKey(selectedKey, editValue)
      
      toast({
        title: 'Success',
        description: 'Key updated successfully',
      })
      setIsEditDialogOpen(false)
      fetchKeys(searchPrefix)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      })
    }
  }

  const handleDeleteKey = async () => {
    if (!selectedKey) return
    
    try {
      await etcdApi.deleteKey(selectedKey)
      
      toast({
        title: 'Success',
        description: 'Key deleted successfully',
      })
      setIsDeleteDialogOpen(false)
      setSelectedKey(null)
      fetchKeys(searchPrefix)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      })
    }
  }

  const openDeleteDialog = () => {
    setDeleteKeyName(selectedKey || '')
    setIsDeleteDialogOpen(true)
  }

  const saveEditValue = async () => {
    if (!selectedKey || !selectedKeyData) return
    
    try {
      await etcdApi.updateKey(selectedKey, editedValue)
      
      toast({
        title: 'Success',
        description: 'Key updated successfully',
      })
      fetchKeys(searchPrefix)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: (error as Error).message,
      })
    }
  }

  const fetchKeyVersions = async (key: string | null) => {
    if (!key) {
      setKeyVersions(null)
      return
    }
    
    setIsLoadingVersions(true)
    try {
      const versions = await etcdApi.getKeyVersions(key)
      setKeyVersions(versions)
    } catch (error) {
      console.error('Failed to fetch key versions:', error)
      setKeyVersions(null)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `Failed to load versions for key "${key}": ${(error as Error).message}`,
      })
    } finally {
      setIsLoadingVersions(false)
    }
  }

  const openCompareDialog = () => {
    if (!keyVersions || keyVersions.versions.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No version history available for comparison',
      })
      return
    }
    
    setLeftVersion(1)
    setRightVersion(keyVersions.currentVersion)
    setLeftHistory(null)
    setRightHistory(null)
    fetchVersionHistory(1, 'left')
    fetchVersionHistory(keyVersions.currentVersion, 'right')
    setIsCompareDialogOpen(true)
  }

  const fetchVersionHistory = async (version: number, side: 'left' | 'right') => {
    if (!selectedKey || !keyVersions) return
    
    const versionInfo = keyVersions.versions.find(v => v.version === version)
    if (!versionInfo) return
    
    try {
      const history = await etcdApi.getKeyHistory(selectedKey, versionInfo.revision)
      if (side === 'left') {
        setLeftHistory(history)
      } else {
        setRightHistory(history)
      }
    } catch (error) {
      console.error('Failed to fetch version history:', error)
    }
  }

  const handleVersionChange = (version: number, side: 'left' | 'right') => {
    if (side === 'left') {
      setLeftVersion(version)
    } else {
      setRightVersion(version)
    }
    fetchVersionHistory(version, side)
  }

  const selectedKeyData = keys.find(k => k.key === selectedKey)

  // Formatting functions
  const formatValue = (value: string, format: 'text' | 'json' | 'yaml'): string => {
    if (!value.trim()) return value
    try {
      switch (format) {
        case 'json':
          return JSON.stringify(JSON.parse(value), null, 2)
        case 'yaml':
          const parsed = JSON.parse(value)
          return Object.entries(parsed).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')
        default:
          return value
      }
    } catch {
      return value
    }
  }

  const getCodeMirrorExtensions = useCallback((format: 'text' | 'json' | 'yaml') => {
    switch (format) {
      case 'json':
        return [json()]
      case 'yaml':
        return [yaml()]
      default:
        return []
    }
  }, [])

  const validateValue = (value: string, format: 'text' | 'json' | 'yaml'): boolean => {
    if (format === 'text') return true
    
    try {
      if (format === 'json') {
        JSON.parse(value)
      }
      return true
    } catch (error) {
      return false
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <EtcdToaster />
      
      {/* Header */}
      <header className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8" />
              <div>
                <h1 className="text-2xl font-bold">Etcd WebUI</h1>
                <p className="text-sm opacity-90">Manage your etcd key-value store</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Navigation */}
              <div className="flex items-center gap-2">
                <Button 
                  variant={activeView === 'keys' ? 'default' : 'outline'} 
                  size="sm" 
                  onClick={() => setActiveView('keys')}
                >
                  Keys
                </Button>
                <Button 
                  variant={activeView === 'clusters' ? 'default' : 'outline'} 
                  size="sm" 
                  onClick={() => setActiveView('clusters')}
                >
                  <Server className="h-4 w-4 mr-1" />
                  Clusters
                </Button>
                <Button 
                  variant={activeView === 'watch' ? 'default' : 'outline'} 
                  size="sm" 
                  onClick={() => setActiveView('watch')}
                >
                  <Database className="h-4 w-4 mr-1" />
                  Watch
                </Button>
              </div>
              
              {/* Theme toggle and Connection status */}
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleTheme}
                  className="text-white hover:bg-white/20"
                >
                  {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 shadow-lg' : 'bg-red-400'}`} />
                <span className="text-sm">
                  {isConnected ? 'Connected to etcd' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Navigation Tabs */}
          <div className="mt-4 flex items-center gap-2 border-b border-white/20">
            <Button 
              variant="ghost" 
              className={`${activeView === 'keys' ? '!bg-white/20 !border-b-2 !border-white' : 'hover:!bg-white/10'} text-white rounded-t-lg`}
              onClick={() => setActiveView('keys')}
            >
              Keys
            </Button>
            <Button 
              variant="ghost" 
              className={`${activeView === 'clusters' ? '!bg-white/20 !border-b-2 !border-white' : 'hover:!bg-white/10'} text-white rounded-t-lg`}
              onClick={() => setActiveView('clusters')}
            >
              Clusters
            </Button>
            <Button 
              variant="ghost" 
              className={`${activeView === 'watch' ? '!bg-white/20 !border-b-2 !border-white' : 'hover:!bg-white/10'} text-white rounded-t-lg`}
              onClick={() => setActiveView('watch')}
            >
              Watch
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeView === 'keys' ? (
          <>
            {/* Cluster Status Card */}
            <ClusterStatusCard isConnected={isConnected} />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
              {/* Sidebar - Key List */}
              <Card className="lg:col-span-1">
                <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-lg">Keys</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={toggleExpandAll} aria-label={isAllExpanded ? "Collapse All" : "Expand All"} title={isAllExpanded ? "Collapse All" : "Expand All"}>
                      {isAllExpanded ? 
                        <ChevronRight className="h-4 w-4" /> : 
                        <ChevronDown className="h-4 w-4" />
                      }
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => fetchKeys(searchPrefix)}>
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Refresh
                    </Button>
                    <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search keys..."
                    value={searchPrefix}
                    onChange={(e) => setSearchPrefix(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pl-9"
                  />
                </div>
              </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
                    </div>
                  ) : keys.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No keys found</p>
                  ) : (
                    <div className="max-h-[600px] overflow-y-auto">
                      {tree.map(node => renderTreeNode(node))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Detail Panel */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">Key Details</CardTitle>
                      {selectedKey && keyVersions && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          (v{keyVersions.currentVersion})
                        </span>
                      )}
                    </div>
                    {selectedKey && selectedKeyData && (
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={openCompareDialog}
                          disabled={isLoadingVersions || !keyVersions || keyVersions.versions.length < 2}
                        >
                          <GitCompare className="h-4 w-4 mr-1" />
                          Compare
                        </Button>
                        <Select value={valueFormat} onValueChange={(value) => setValueFormat(value as 'text' | 'json' | 'yaml')}>
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Format" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="json">JSON</SelectItem>
                            <SelectItem value="yaml">YAML</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedKey && selectedKeyData ? (
                    <div>
                      <div className="mb-4">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Key</label>
                        <p className="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1 break-all">{selectedKey}</p>
                      </div>
                      {selectedKeyData && (
                        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">版本:</span>
                              <span className="ml-2 font-medium">{selectedKeyData.version || '-'}</span>
                            </div>
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">创建版本:</span>
                              <span className="ml-2 font-medium">{selectedKeyData.createRevision || '-'}</span>
                            </div>
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">修订版本:</span>
                              <span className="ml-2 font-medium">{selectedKeyData.modRevision || '-'}</span>
                            </div>
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">大小:</span>
                              <span className="ml-2 font-medium">{selectedKeyData.value ? new Blob([selectedKeyData.value]).size + 'B' : '-'}</span>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="mb-4">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Value</label>
                        <div className={`mt-1 border rounded-md ${!validateValue(editedValue, valueFormat) ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`}>
                          <CodeMirror
                            value={editedValue}
                            minHeight="200px"
                            extensions={getCodeMirrorExtensions(valueFormat)}
                            theme={isDarkMode ? 'dark' : 'light'}
                            onChange={(value) => setEditedValue(value)}
                            className="text-sm"
                          />
                        </div>
                        {!validateValue(editedValue, valueFormat) && (
                          <p className="text-xs text-red-500 mt-1">Invalid {valueFormat} format</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline"
                          onClick={() => setEditedValue(selectedKeyData.value)}
                          disabled={editedValue === selectedKeyData.value}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Reset
                        </Button>
                        <Button 
                          onClick={saveEditValue}
                          disabled={editedValue === selectedKeyData.value || !validateValue(editedValue, valueFormat)}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Save
                        </Button>
                        <Button variant="destructive" onClick={openDeleteDialog}>
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <Database className="h-16 w-16 mb-4 opacity-30" />
                      <p className="text-lg">Select a key to view details</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : activeView === 'clusters' ? (
          <ClusterManager onClusterChange={fetchKeys} />
        ) : (
          <>
            {/* Cluster Status Card */}
            <ClusterStatusCard isConnected={isConnected} />
            
            <div className="mt-6">
              <WatchPanel isConnected={isConnected} />
            </div>
          </>
        )}
      </div>

      {/* Add Key Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Key</label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Enter key path"
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Value</label>
                <div className="flex items-center gap-2">
                  <Select value={newValueFormat} onValueChange={(value) => setNewValueFormat(value as 'text' | 'json' | 'yaml')}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="yaml">YAML</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setNewValue(formatValue(newValue, newValueFormat))}
                  >
                    Format
                  </Button>
                </div>
              </div>
              <Textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={`Enter ${newValueFormat} value`}
                className={`mt-1 ${!validateValue(newValue, newValueFormat) ? 'border-red-500' : ''}`}
              />
              {!validateValue(newValue, newValueFormat) && (
                <p className="text-xs text-red-500 mt-1">Invalid {newValueFormat} format</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddKey} disabled={!validateValue(newValue, newValueFormat)}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Key Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Key</DialogTitle>
          </DialogHeader>
          <div className="py-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Value</label>
              <div className="flex items-center gap-2">
                <Select value={editValueFormat} onValueChange={(value) => setEditValueFormat(value as 'text' | 'json' | 'yaml')}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="yaml">YAML</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setEditValue(formatValue(editValue, editValueFormat))}
                >
                  Format
                </Button>
              </div>
            </div>
            <CodeMirror
                value={editValue}
                height="300px"
                width="100%"
                extensions={getCodeMirrorExtensions(editValueFormat)}
                onChange={(val: string) => setEditValue(val)}
                className={`mt-1 border rounded-md overflow-hidden ${!validateValue(editValue, editValueFormat) ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`}
              />
            {!validateValue(editValue, editValueFormat) && (
              <p className="text-xs text-red-500 mt-1">Invalid {editValueFormat} format</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditKey} disabled={!validateValue(editValue, editValueFormat)}>
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Key Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Key</DialogTitle>
          </DialogHeader>
          <p className="text-gray-600 py-4">
            Are you sure you want to delete this key? This action cannot be undone.
          </p>
          <p className="font-medium bg-gray-100 dark:bg-gray-800 p-2 rounded break-all">{deleteKeyName}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteKey}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version Compare Dialog */}
      <Dialog open={isCompareDialogOpen} onOpenChange={setIsCompareDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Version Comparison</DialogTitle>
          </DialogHeader>
          <div className="py-4 overflow-hidden flex-1 flex flex-col">
            {keyVersions && (
              <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Left Version:</label>
                  <Select 
                    value={leftVersion?.toString() || ''} 
                    onValueChange={(value) => handleVersionChange(parseInt(value), 'left')}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Select version" />
                    </SelectTrigger>
                    <SelectContent>
                      {keyVersions.versions.map((v) => (
                        <SelectItem key={v.version} value={v.version.toString()}>
                          v{v.version} (r{v.revision})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Format:</label>
                  <Select value={compareFormat} onValueChange={(value) => setCompareFormat(value as 'text' | 'json' | 'yaml')}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="yaml">YAML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Right Version:</label>
                  <Select 
                    value={rightVersion?.toString() || ''} 
                    onValueChange={(value) => handleVersionChange(parseInt(value), 'right')}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Select version" />
                    </SelectTrigger>
                    <SelectContent>
                      {keyVersions.versions.map((v) => (
                        <SelectItem key={v.version} value={v.version.toString()}>
                          v{v.version} (r{v.revision})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
              <div className="flex flex-col overflow-hidden">
                <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-t-md border border-b-0 border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-medium">
                    {leftHistory ? `Version ${leftHistory.version}` : 'Loading...'}
                  </span>
                </div>
                <div className="flex-1 border rounded-b-md overflow-hidden">
                  {leftHistory ? (
                    <CodeMirror
                      value={leftHistory.value}
                      height="300px"
                      extensions={getCodeMirrorExtensions(compareFormat)}
                      theme={isDarkMode ? 'dark' : 'light'}
                      readOnly
                      className="text-sm h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-400">
                      Select a version to view
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex flex-col overflow-hidden">
                <div className="bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-t-md border border-b-0 border-gray-200 dark:border-gray-700">
                  <span className="text-sm font-medium">
                    {rightHistory ? `Version ${rightHistory.version}` : 'Loading...'}
                  </span>
                </div>
                <div className="flex-1 border rounded-b-md overflow-hidden">
                  {rightHistory ? (
                    <CodeMirror
                      value={rightHistory.value}
                      height="300px"
                      extensions={getCodeMirrorExtensions(compareFormat)}
                      theme={isDarkMode ? 'dark' : 'light'}
                      readOnly
                      className="text-sm h-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-[300px] text-gray-400">
                      Select a version to view
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompareDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export default App
