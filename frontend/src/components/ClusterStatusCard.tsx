import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { etcdApi, type ClusterStatus, type ClusterFeatures } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'
import { Server, Database, HardDrive, Activity, Users, Hash, ChevronDown, ChevronUp, Wrench } from 'lucide-react'

interface ClusterStatusCardProps {
  isConnected: boolean
  onFeaturesUpdate?: (features: ClusterFeatures) => void
  onOpenMaintenance?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatNumber(num: number | bigint): string {
  return num.toLocaleString()
}

export function ClusterStatusCard({ isConnected, onFeaturesUpdate, onOpenMaintenance }: ClusterStatusCardProps) {
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('clusterStatusCollapsed')
    return saved === 'true'
  })
  const { toast } = useToast()

  useEffect(() => {
    if (isConnected) {
      fetchClusterStatus()
      const interval = setInterval(fetchClusterStatus, 10000)
      return () => clearInterval(interval)
    } else {
      setClusterStatus(null)
    }
  }, [isConnected])

  const toggleCollapsed = () => {
    const newValue = !isCollapsed
    setIsCollapsed(newValue)
    localStorage.setItem('clusterStatusCollapsed', String(newValue))
  }

  const fetchClusterStatus = async () => {
    setIsLoading(true)
    try {
      const status = await etcdApi.getClusterStatus()
      setClusterStatus(status)
      if (onFeaturesUpdate && status.features) {
        onFeaturesUpdate(status.features)
      }
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
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5" />
            Cluster Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>Not connected to etcd cluster</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Cluster Status
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={fetchClusterStatus}
              className="text-sm text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 flex items-center gap-1"
            >
              <Activity className="h-3 w-3" />
              Refresh
            </button>
            {onOpenMaintenance && (
              <button 
                onClick={onOpenMaintenance}
                className="text-sm text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 flex items-center gap-1"
                title="Maintenance"
              >
                <Wrench className="h-3 w-3" />
                Maintenance
              </button>
            )}
            <button
              onClick={toggleCollapsed}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            >
              {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      {!isCollapsed && (
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
            </div>
          ) : clusterStatus ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/30 dark:to-violet-900/20 p-3 rounded-lg border border-violet-200 dark:border-violet-800">
                  <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 mb-1">
                    <Hash className="h-4 w-4" />
                    <p className="text-xs font-medium">Cluster ID</p>
                  </div>
                  <p className="text-sm font-semibold text-violet-900 dark:text-violet-100 truncate" title={clusterStatus.clusterId}>
                    {clusterStatus.clusterId}
                  </p>
                </div>
                
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/30 dark:to-indigo-900/20 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">
                    <Database className="h-4 w-4" />
                    <p className="text-xs font-medium">Version</p>
                  </div>
                  <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">{clusterStatus.etcdVersion}</p>
                </div>
                
                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
                    <Users className="h-4 w-4" />
                    <p className="text-xs font-medium">Members</p>
                  </div>
                  <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                    {clusterStatus.clusterSize}
                    <span className="text-xs font-normal text-green-700 dark:text-green-400 ml-1">
                      (1L/{clusterStatus.followerCount}F)
                    </span>
                  </p>
                </div>
                
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
                    <HardDrive className="h-4 w-4" />
                    <p className="text-xs font-medium">DB Size</p>
                  </div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    {formatBytes(clusterStatus.totalDbSize)}
                  </p>
                </div>
                
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/30 dark:to-cyan-900/20 p-3 rounded-lg border border-cyan-200 dark:border-cyan-800">
                  <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 mb-1">
                    <Hash className="h-4 w-4" />
                    <p className="text-xs font-medium">Total Keys</p>
                  </div>
                  <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">
                    {formatNumber(clusterStatus.totalKeys)}
                  </p>
                </div>
                
                <div className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-950/30 dark:to-rose-900/20 p-3 rounded-lg border border-rose-200 dark:border-rose-800">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 mb-1">
                    <Activity className="h-4 w-4" />
                    <p className="text-xs font-medium">Revision</p>
                  </div>
                  <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                    {formatNumber(clusterStatus.revision)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Raft Index</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatNumber(clusterStatus.raftIndex)}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Raft Term</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatNumber(clusterStatus.raftTerm)}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Raft Applied</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatNumber(clusterStatus.raftAppliedIndex)}</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  Nodes
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {clusterStatus.members.map((node) => (
                    <div 
                      key={node.id} 
                      className={`p-3 rounded-lg border ${node.isLeader 
                        ? 'border-green-300 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20 dark:border-green-800' 
                        : 'border-gray-300 bg-gray-50 dark:bg-gray-700/50 dark:border-gray-600'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-3 w-3 rounded-full ${node.isLeader ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`} />
                          <span className="font-medium text-gray-900 dark:text-gray-100">{node.name || node.endpoint}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${node.isLeader 
                          ? 'bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-300' 
                          : 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300'}`}>
                          {node.role}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 break-all">{node.endpoint}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="text-gray-500 dark:text-gray-400">ID: {node.id}</div>
                        <div className="text-gray-500 dark:text-gray-400">Version: {node.version}</div>
                        <div className="text-gray-500 dark:text-gray-400">DB: {formatBytes(node.dbSize)}</div>
                        <div className="text-gray-500 dark:text-gray-400">RaftIdx: {formatNumber(node.raftIndex)}</div>
                        <div className="col-span-2 text-gray-500 dark:text-gray-400">
                          Started: {new Date(node.startTime).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p>Failed to fetch cluster status</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
