import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Activity, Database, TrendingUp, Users, HardDrive } from 'lucide-react'
import { etcdApi, type MetricsResponse } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'

export function MetricsPanel() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const { toast } = useToast()

  const fetchMetrics = async () => {
    try {
      setIsLoading(true)
      const data = await etcdApi.getMetrics()
      setMetrics(data)
    } catch (error) {
      toast({
        title: 'Failed to fetch metrics',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchMetrics()
    }, 5000) // 每5秒刷新一次

    return () => clearInterval(interval)
  }, [autoRefresh])

  const formatBytes = (bytes: number | undefined | null) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const formatNumber = (num: number | undefined | null) => {
    if (num === undefined || num === null) return '0'
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`
    }
    return num.toFixed(2)
  }

  if (isLoading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!metrics) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <p>Failed to load metrics</p>
            <Button onClick={fetchMetrics} className="mt-4" variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cluster Metrics</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Server Version: {metrics.serverVersion || 'Unknown'} | Cluster ID: {metrics.clusterId || 'Unknown'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? 'default' : 'outline'}
          >
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Stop Auto Refresh' : 'Auto Refresh'}
          </Button>
          <Button onClick={fetchMetrics} variant="outline" disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* 概览统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(metrics.summary?.totalRequests)}</div>
            <p className="text-xs text-muted-foreground mt-1">Total requests</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Keys</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(metrics.summary?.totalKeys)}</div>
            <p className="text-xs text-muted-foreground mt-1">Total keys stored</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Database Size</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBytes(metrics.summary?.totalDbSize)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Used: {formatBytes(metrics.summary?.totalDbSizeInUse)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cluster Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(metrics.members?.length || 0) > 0
                ? metrics.summary.leaderCount + metrics.summary.followerCount
                : 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Leader: {metrics.summary.leaderCount || 0} | Followers: {metrics.summary.followerCount || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Raft 统计 */}
      {((metrics.summary?.raftProposals ?? 0) > 0 ||
        (metrics.summary?.raftCommitted ?? 0) > 0 ||
        (metrics.summary?.raftApplied ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Raft Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Proposals</div>
                <div className="text-xl font-semibold">{formatNumber(metrics.summary?.raftProposals)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Committed</div>
                <div className="text-xl font-semibold">{formatNumber(metrics.summary?.raftCommitted)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Applied</div>
                <div className="text-xl font-semibold">{formatNumber(metrics.summary?.raftApplied)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

