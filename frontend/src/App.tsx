import { useEffect, useState } from 'react'
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
import { Plus, Trash2, Edit2, Search, Database } from 'lucide-react'
import { etcdApi, type EtcdKey } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'
import { EtcdToaster } from '@/components/ui/toaster'

function App() {
  const [keys, setKeys] = useState<EtcdKey[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [searchPrefix, setSearchPrefix] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  
  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  
  // Form states
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editValue, setEditValue] = useState('')
  const [deleteKeyName, setDeleteKeyName] = useState('')
  
  const { toast } = useToast()

  useEffect(() => {
    fetchKeys()
    checkHealth()
    
    const interval = setInterval(checkHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchKeys = async (prefix?: string) => {
    setIsLoading(true)
    try {
      const data = await etcdApi.getKeys(prefix)
      setKeys(data.sort((a, b) => a.key.localeCompare(b.key)))
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

  const handleSelectKey = (key: string) => {
    setSelectedKey(key)
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

  const openEditDialog = () => {
    const key = keys.find(k => k.key === selectedKey)
    if (key) {
      setEditValue(key.value)
      setIsEditDialogOpen(true)
    }
  }

  const openDeleteDialog = () => {
    setDeleteKeyName(selectedKey || '')
    setIsDeleteDialogOpen(true)
  }

  const selectedKeyData = keys.find(k => k.key === selectedKey)

  return (
    <div className="min-h-screen bg-gray-50">
      <EtcdToaster />
      
      {/* Header */}
      <header className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8" />
              <div>
                <h1 className="text-2xl font-bold">Etcd WebUI</h1>
                <p className="text-sm opacity-90">Manage your etcd key-value store</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400 shadow-lg' : 'bg-red-400'}`} />
              <span className="text-sm">
                {isConnected ? 'Connected to etcd' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar - Key List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Keys</CardTitle>
                <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
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
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {keys.map((kv) => (
                    <div
                      key={kv.key}
                      onClick={() => handleSelectKey(kv.key)}
                      className={`p-3 rounded-lg cursor-pointer transition-all ${
                        selectedKey === kv.key
                          ? 'bg-violet-100 border-violet-300 border'
                          : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
                      }`}
                    >
                      <p className="font-medium text-sm text-gray-800 truncate">{kv.key}</p>
                      <p className="text-xs text-gray-500 truncate mt-1">{kv.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detail Panel */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Key Details</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedKey && selectedKeyData ? (
                <div>
                  <div className="mb-4">
                    <label className="text-sm font-medium text-gray-700">Key</label>
                    <p className="text-sm bg-gray-100 p-2 rounded mt-1 break-all">{selectedKey}</p>
                  </div>
                  <div className="mb-4">
                    <label className="text-sm font-medium text-gray-700">Value</label>
                    <Textarea
                      value={selectedKeyData.value}
                      readOnly
                      className="mt-1 font-mono text-sm bg-gray-50"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={openEditDialog}>
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
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
              <label className="text-sm font-medium">Value</label>
              <Textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Enter value"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddKey}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Key Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Key</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">Value</label>
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="mt-1 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditKey}>Update</Button>
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
          <p className="font-medium bg-gray-100 p-2 rounded break-all">{deleteKeyName}</p>
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
    </div>
  )
}

export default App
