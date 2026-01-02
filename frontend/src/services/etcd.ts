

const API_BASE = '/api'

export interface EtcdKey {
  key: string
  value: string
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
  async getKeys(prefix?: string): Promise<EtcdKey[]> {
    const url = prefix 
      ? `${API_BASE}/keys?prefix=${encodeURIComponent(prefix)}`
      : `${API_BASE}/keys`
    
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('Failed to fetch keys')
    }
    
    return response.json()
  },

  async getKey(key: string): Promise<EtcdKey> {
    const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(key)}`)
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Key not found')
      }
      throw new Error('Failed to fetch key')
    }
    
    return response.json()
  },

  async createKey(key: string, value: string): Promise<void> {
    const response = await fetch(`${API_BASE}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create key')
    }
  },

  async updateKey(key: string, value: string): Promise<void> {
    const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update key')
    }
  },

  async deleteKey(key: string): Promise<void> {
    const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete key')
    }
  },

  async deleteKeys(keys: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}/keys`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete keys')
    }
  },

  async exportKeys(): Promise<void> {
    const response = await fetch(`${API_BASE}/keys/export`)
    
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
    const response = await fetch(`${API_BASE}/keys/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keys),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to import keys')
    }
  },

  async checkHealth(): Promise<HealthStatus> {
    const response = await fetch(`${API_BASE}/health`)
    if (!response.ok) {
      return { status: 'unhealthy', etcd: 'error', error: `HTTP ${response.status}` }
    }
    return response.json()
  },

  async getClusterStatus(): Promise<ClusterStatus> {
    const response = await fetch(`${API_BASE}/cluster/status`)
    if (!response.ok) {
      throw new Error('Failed to fetch cluster status')
    }
    return response.json()
  },
}
