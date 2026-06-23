import { clusterApi } from './cluster'

const API_BASE = '/api'

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: any
}

async function clusterRequest(url: string, options: RequestOptions = {}) {
  const activeCluster = clusterApi.getActiveCluster()
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  
  if (activeCluster) {
    // 将集群配置转换为base64编码的JSON字符串
    headers['X-Cluster-Config'] = btoa(JSON.stringify(activeCluster))
  }
  
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  
  return response
}

export interface EtcdKey {
  key: string
  value: string
  version?: number
  modRevision?: number
  createRevision?: number
}

export interface KeyVersion {
  version: number
  revision: number
}

export interface KeyVersionsResponse {
  key: string
  currentVersion: number
  createRevision: number
  versions: KeyVersion[]
}

export interface KeyHistoryResponse {
  key: string
  value: string
  revision: number
  version: number
}

export interface KeyChild {
  name: string
  path: string
  isLeaf: boolean
}

export interface KeyChildrenResponse {
  children: KeyChild[]
  truncated: boolean
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy'
  etcd: string
  error?: string
}

export interface ClusterNode {
  id: string
  name: string
  endpoint: string
  role: 'leader' | 'follower'
  version: string
  dbSize: number
  isLeader: boolean
  startTime: string
  raftIndex: number
  raftTerm: number
  raftAppliedIndex: number
}

export interface ClusterStatus {
  members: ClusterNode[]
  leader: number
  leaderId: string
  revision: number
  clusterSize: number
  etcdVersion: string
  leaderCount: number
  followerCount: number
  totalDbSize: number
  totalKeys: number
  raftIndex: number
  raftTerm: number
  raftAppliedIndex: number
  storageVersion: string
  clusterId: string
  features: ClusterFeatures
}

export interface ClusterFeatures {
  compactSupported: boolean
  defragSupported: boolean
  maxCompactRevision: number
  minDefragVersion: string
}

export interface WatchEvent {
  type: 'PUT' | 'DELETE'
  key: string
  oldValue?: string
  newValue?: string
  revision: number
  leaseID?: number
  time: string
}

export const etcdApi = {
  async getKeys(prefix?: string, limit?: number): Promise<EtcdKey[]> {
    let url = `${API_BASE}/keys`
    const params = new URLSearchParams()
    
    if (prefix) {
      params.set('prefix', prefix)
    }
    if (limit && limit > 0) {
      params.set('limit', limit.toString())
    }
    
    const queryString = params.toString()
    if (queryString) {
      url += `?${queryString}`
    }
    
    const response = await clusterRequest(url)
    if (!response.ok) {
      throw new Error('Failed to fetch keys')
    }
    
    const data = await response.json()
    return data.keys || []
  },

  async getKeyChildren(prefix?: string): Promise<KeyChildrenResponse> {
    const params = new URLSearchParams()
    if (prefix) {
      params.set('prefix', prefix)
    }

    const queryString = params.toString()
    const url = queryString ? `${API_BASE}/keys/children?${queryString}` : `${API_BASE}/keys/children`

    const response = await clusterRequest(url)
    if (!response.ok) {
      throw new Error('Failed to fetch key children')
    }

    return response.json()
  },

  async getKey(key: string): Promise<EtcdKey> {
    const response = await clusterRequest(`${API_BASE}/keys?key=${encodeURIComponent(key)}`)
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Key not found')
      }
      throw new Error('Failed to fetch key')
    }
    
    return response.json()
  },

  async getKeyVersions(key: string): Promise<KeyVersionsResponse> {
    const response = await clusterRequest(`${API_BASE}/keys/versions?key=${encodeURIComponent(key)}`)
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Key not found')
      }
      throw new Error('Failed to fetch key versions')
    }
    
    return response.json()
  },

  async getKeyHistory(key: string, revision?: number): Promise<KeyHistoryResponse> {
    let url = `${API_BASE}/keys/history?key=${encodeURIComponent(key)}`
    if (revision !== undefined) {
      url += `&revision=${revision}`
    }
    
    const response = await clusterRequest(url)
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Key history not found at specified revision')
      }
      throw new Error('Failed to fetch key history')
    }
    
    return response.json()
  },

  async createKey(key: string, value: string): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys`, {
      method: 'POST',
      body: { key, value },
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create key')
        } catch {
          throw new Error(`Failed to create key: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to create key: HTTP ${response.status}`)
    }
  },

  async updateKey(key: string, value: string): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value },
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to update key')
        } catch {
          throw new Error(`Failed to update key: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to update key: HTTP ${response.status}`)
    }
  },

  async deleteKey(key: string): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete key')
        } catch {
          throw new Error(`Failed to delete key: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to delete key: HTTP ${response.status}`)
    }
  },

  async deleteKeys(keys: string[]): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys`, {
      method: 'DELETE',
      body: { keys },
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete keys')
        } catch {
          throw new Error(`Failed to delete keys: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to delete keys: HTTP ${response.status}`)
    }
  },

  async exportKeys(): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys/export`)
    
    if (!response.ok) {
      throw new Error('Failed to export keys')
    }
    
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'etcd-keys.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  async importKeys(keys: EtcdKey[]): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/keys/import`, {
      method: 'POST',
      body: keys,
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to import keys')
        } catch {
          throw new Error(`Failed to import keys: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to import keys: HTTP ${response.status}`)
    }
  },

  async checkHealth(): Promise<HealthStatus> {
    const response = await clusterRequest(`${API_BASE}/health`)
    if (!response.ok) {
      return { status: 'unhealthy', etcd: 'error', error: `HTTP ${response.status}` }
    }
    return response.json()
  },

  async getClusterStatus(): Promise<ClusterStatus> {
    const response = await clusterRequest(`${API_BASE}/cluster/status`)
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to fetch cluster status')
        } catch {
          throw new Error(`Failed to fetch cluster status: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to fetch cluster status: HTTP ${response.status}`)
    }
    return response.json()
  },

  async compact(revision: number): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/cluster/compact`, {
      method: 'POST',
      body: { revision },
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to compact')
        } catch {
          throw new Error(`Failed to compact: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to compact: HTTP ${response.status}`)
    }
  },

  async defrag(): Promise<void> {
    const response = await clusterRequest(`${API_BASE}/cluster/defrag`, {
      method: 'POST',
    })
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to defragment')
        } catch {
          throw new Error(`Failed to defragment: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to defragment: HTTP ${response.status}`)
    }
  },

  async getMetrics(): Promise<MetricsResponse> {
    const response = await clusterRequest(`${API_BASE}/cluster/metrics`)
    
    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          const error = await response.json()
          throw new Error(error.error || 'Failed to fetch metrics')
        } catch {
          throw new Error(`Failed to fetch metrics: HTTP ${response.status}`)
        }
      }
      throw new Error(`Failed to fetch metrics: HTTP ${response.status}`)
    }
    
    return response.json()
  },
}

export interface MemberMetrics {
  endpoint: string
  isLeader: boolean
  dbSize: number
  dbSizeInUse: number
  raftIndex: number
  raftTerm: number
  raftAppliedIndex: number
  raftCommittedIndex: number
}

export interface MetricsSummary {
  totalRequests: number
  totalKeys: number
  totalDbSize: number
  totalDbSizeInUse: number
  averageLatency: number
  leaderCount: number
  followerCount: number
  raftProposals: number
  raftCommitted: number
  raftApplied: number
}

export interface MetricsResponse {
  serverVersion: string
  clusterId: string
  members: MemberMetrics[] | null
  summary: MetricsSummary
  rawMetrics?: Record<string, any>
}
