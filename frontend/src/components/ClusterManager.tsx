import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Trash2, Edit2, Check, X, Server, Database, Eye, EyeOff } from 'lucide-react'
import { clusterApi, type ClusterConfig, defaultClusterConfig } from '@/services/cluster'
import { useToast } from '@/hooks/use-toast'
import { EtcdToaster } from '@/components/ui/toaster'

interface ClusterManagerProps {
  onClusterChange?: () => void
}

export function ClusterManager({ onClusterChange }: ClusterManagerProps) {
  const [clusters, setClusters] = useState<ClusterConfig[]>([])
  const [activeCluster, setActiveCluster] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isEditPasswordVisible, setIsEditPasswordVisible] = useState(false)
  
  // Form states
  const [formData, setFormData] = useState<Omit<ClusterConfig, 'id'>>({ ...defaultClusterConfig })
  const [editFormData, setEditFormData] = useState<ClusterConfig>({ ...defaultClusterConfig, id: '' })
  const [deleteClusterId, setDeleteClusterId] = useState('')
  
  const { toast } = useToast()

  useEffect(() => {
    loadClusters()
  }, [])

  const loadClusters = () => {
    const allClusters = clusterApi.getAllClusters()
    const active = clusterApi.getActiveCluster()
    
    setClusters(allClusters)
    setActiveCluster(active?.id || null)
  }

  const handleAddCluster = () => {
    const newCluster = clusterApi.addCluster(formData)
    setClusters([...clusters, newCluster])
    
    // Set as active if it's the first cluster
    if (clusters.length === 0) {
      clusterApi.setActiveCluster(newCluster.id)
      setActiveCluster(newCluster.id)
    }
    
    toast({
      title: 'Success',
      description: 'Cluster added successfully',
    })
    
    resetForm()
    setIsAddDialogOpen(false)
    if (onClusterChange) onClusterChange()
  }

  const handleEditCluster = () => {
    clusterApi.updateCluster(editFormData)
    
    const updatedClusters = clusters.map(c => 
      c.id === editFormData.id ? editFormData : c
    )
    setClusters(updatedClusters)
    
    // Update active cluster if it was edited
    if (activeCluster === editFormData.id) {
      clusterApi.setActiveCluster(editFormData.id)
    }
    
    toast({
      title: 'Success',
      description: 'Cluster updated successfully',
    })
    
    setIsEditDialogOpen(false)
    if (onClusterChange) onClusterChange()
  }

  const handleDeleteCluster = () => {
    clusterApi.deleteCluster(deleteClusterId)
    
    const updatedClusters = clusters.filter(c => c.id !== deleteClusterId)
    setClusters(updatedClusters)
    
    // Clear active cluster if it was deleted
    if (activeCluster === deleteClusterId) {
      setActiveCluster(null)
    }
    
    toast({
      title: 'Success',
      description: 'Cluster deleted successfully',
    })
    
    setIsDeleteDialogOpen(false)
    if (onClusterChange) onClusterChange()
  }

  const handleSetActiveCluster = (clusterId: string) => {
    clusterApi.setActiveCluster(clusterId)
    setActiveCluster(clusterId)
    
    toast({
      title: 'Success',
      description: 'Active cluster changed successfully',
    })
    
    if (onClusterChange) onClusterChange()
  }

  const openEditDialog = (cluster: ClusterConfig) => {
    setEditFormData({ ...cluster })
    setIsEditDialogOpen(true)
  }

  const openDeleteDialog = (clusterId: string) => {
    setDeleteClusterId(clusterId)
    setIsDeleteDialogOpen(true)
  }

  const resetForm = () => {
    setFormData({ ...defaultClusterConfig })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <EtcdToaster />
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Server className="h-8 w-8 text-violet-600" />
            <h1 className="text-2xl font-bold text-gray-900">Cluster Manager</h1>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Cluster
          </Button>
        </div>

        {clusters.length === 0 ? (
          <Card className="text-center py-12">
            <Database className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No clusters configured</h3>
            <p className="text-gray-600 mb-6">Add your first etcd cluster to get started</p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Cluster
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {clusters.map(cluster => (
              <Card key={cluster.id} className={`transition-all ${activeCluster === cluster.id ? 'ring-2 ring-violet-500' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${activeCluster === cluster.id ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <CardTitle className="text-lg">{cluster.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => openEditDialog(cluster)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="destructive" 
                        onClick={() => openDeleteDialog(cluster.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <span className="text-gray-500">Endpoint:</span>
                      <span className="col-span-2 font-mono">{cluster.endpoint}</span>
                    </div>
                    {cluster.username && (
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <span className="text-gray-500">Username:</span>
                        <span className="col-span-2">{cluster.username}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <span className="text-gray-500">TLS:</span>
                      <span className="col-span-2">{cluster.tls ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <span className="text-gray-500">Dial Timeout:</span>
                      <span className="col-span-2">{cluster.dialTimeout}ms</span>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {activeCluster !== cluster.id && (
                      <Button 
                        className="w-full" 
                        size="sm" 
                        onClick={() => handleSetActiveCluster(cluster.id)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Set as Active
                      </Button>
                    )}
                    {activeCluster === cluster.id && (
                      <Button 
                        className="w-full" 
                        size="sm" 
                        variant="secondary"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Active Cluster
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add Cluster Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Cluster</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Cluster Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Cluster"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Endpoint</label>
                <Input
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                  placeholder="http://localhost:2379"
                  className="mt-1"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Username</label>
                <Input
                  value={formData.username || ''}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="Optional"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Password</label>
                <div className="relative mt-1">
                  <Input
                    type={isPasswordVisible ? 'text' : 'password'}
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Optional"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">TLS</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={formData.tls}
                    onChange={(e) => setFormData({ ...formData, tls: e.target.checked })}
                    className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm text-gray-600">Enable TLS</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Dial Timeout (ms)</label>
                <Input
                  type="number"
                  value={formData.dialTimeout}
                  onChange={(e) => setFormData({ ...formData, dialTimeout: parseInt(e.target.value) || 5000 })}
                  placeholder="5000"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCluster}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Cluster Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Cluster</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Cluster Name</label>
                <Input
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  placeholder="My Cluster"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Endpoint</label>
                <Input
                  value={editFormData.endpoint}
                  onChange={(e) => setEditFormData({ ...editFormData, endpoint: e.target.value })}
                  placeholder="http://localhost:2379"
                  className="mt-1"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Username</label>
                <Input
                  value={editFormData.username || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                  placeholder="Optional"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Password</label>
                <div className="relative mt-1">
                  <Input
                    type={isEditPasswordVisible ? 'text' : 'password'}
                    value={editFormData.password || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    placeholder="Optional"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setIsEditPasswordVisible(!isEditPasswordVisible)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {isEditPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">TLS</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={editFormData.tls}
                    onChange={(e) => setEditFormData({ ...editFormData, tls: e.target.checked })}
                    className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm text-gray-600">Enable TLS</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Dial Timeout (ms)</label>
                <Input
                  type="number"
                  value={editFormData.dialTimeout}
                  onChange={(e) => setEditFormData({ ...editFormData, dialTimeout: parseInt(e.target.value) || 5000 })}
                  placeholder="5000"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditCluster}>
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Cluster Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Cluster</DialogTitle>
          </DialogHeader>
          <p className="text-gray-600 py-4">
            Are you sure you want to delete this cluster? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteCluster}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}