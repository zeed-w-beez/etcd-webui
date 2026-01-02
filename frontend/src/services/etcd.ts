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

  async checkHealth(): Promise<HealthStatus> {
    const response = await fetch(`${API_BASE}/health`)
    return response.json()
  },
}
