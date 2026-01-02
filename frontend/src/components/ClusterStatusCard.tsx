import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { etcdApi, type ClusterStatus } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'

interface ClusterStatusCardProps {
  isConnected: boolean
}

export function ClusterStatusCard({ isConnected }: ClusterStatusCardProps) {
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    if (isConnected) {
      fetchClusterStatus()
      const interval = setInterval(fetchClusterStatus, 10000) // Refresh every 10 seconds
      return () => clearInterval(interval)
    } else {
      setClusterStatus(null)
    }
  }, [isConnected])

  const fetchClusterStatus = async () => {
    setIsLoading(true)
    try {
      const status = await etcdApi.getClusterStatus()
      setClusterStatus(status)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch cluster status',
      })
    } finally {
      setIsLoading(false)
    }
  }

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cluster Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <p>Not connected to etcd cluster</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          Cluster Status
          <button 
            onClick={fetchClusterStatus}
            className="text-sm text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
          </div>
        ) : clusterStatus ? (
          <div className="space-y-4">
            {/* Cluster Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Cluster Size</p>
                <p className="text-xl font-semibold">{clusterStatus.clusterSize}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Leader</p>
                <p className="text-xl font-semibold">
                  {clusterStatus.members.filter(m => m.isLeader).length}
                </p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Followers</p>
                <p className="text-xl font-semibold">
                  {clusterStatus.members.filter(m => !m.isLeader).length}
                </p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Revision</p>
                <p className="text-xl font-semibold">{clusterStatus.revision}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg md:col-span-2 lg:col-span-2">
                <p className="text-sm text-gray-600">etcd Version</p>
                <p className="text-xl font-semibold">{clusterStatus.etcdVersion}</p>
              </div>
            </div>

            {/* Nodes List */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Nodes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {clusterStatus.members.map((node) => (
                  <div 
                    key={node.id} 
                    className={`p-3 rounded-lg border ${node.isLeader 
                      ? 'border-green-300 bg-green-50' 
                      : 'border-gray-300 bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${node.isLeader ? 'bg-green-500' : 'bg-gray-400'}`} />
                        <span className="font-medium">{node.name || node.endpoint}</span>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${node.isLeader 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'}`}>
                        {node.role}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600 break-all">{node.endpoint}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="text-gray-500">Version: {node.version}</div>
                      <div className="text-gray-500">DB Size: {(node.dbSize / 1024 / 1024).toFixed(2)} MB</div>
                      <div className="text-gray-500 col-span-2">
                        Started: {new Date(node.startTime).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>Failed to fetch cluster status</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}