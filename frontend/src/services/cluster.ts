export interface ClusterConfig {
  id: string
  name: string
  endpoint: string
  username?: string
  password?: string
  tls: boolean
  certPath?: string
  keyPath?: string
  caPath?: string
  dialTimeout: number
}

const CLUSTER_STORAGE_KEY = 'etcd-webui-clusters'
const ACTIVE_CLUSTER_KEY = 'etcd-webui-active-cluster'

export const clusterApi = {
  // Get all clusters
  getAllClusters(): ClusterConfig[] {
    const clusters = localStorage.getItem(CLUSTER_STORAGE_KEY)
    return clusters ? JSON.parse(clusters) : []
  },

  // Get active cluster
  getActiveCluster(): ClusterConfig | null {
    const activeId = localStorage.getItem(ACTIVE_CLUSTER_KEY)
    if (!activeId) return null
    
    const clusters = this.getAllClusters()
    return clusters.find(c => c.id === activeId) || null
  },

  // Set active cluster
  setActiveCluster(clusterId: string): void {
    localStorage.setItem(ACTIVE_CLUSTER_KEY, clusterId)
  },

  // Add new cluster
  addCluster(cluster: Omit<ClusterConfig, 'id'>): ClusterConfig {
    const newCluster: ClusterConfig = {
      ...cluster,
      id: crypto.randomUUID()
    }
    
    const clusters = this.getAllClusters()
    clusters.push(newCluster)
    localStorage.setItem(CLUSTER_STORAGE_KEY, JSON.stringify(clusters))
    
    return newCluster
  },

  // Update existing cluster
  updateCluster(cluster: ClusterConfig): void {
    const clusters = this.getAllClusters()
    const index = clusters.findIndex(c => c.id === cluster.id)
    
    if (index !== -1) {
      clusters[index] = cluster
      localStorage.setItem(CLUSTER_STORAGE_KEY, JSON.stringify(clusters))
    }
  },

  // Delete cluster
  deleteCluster(clusterId: string): void {
    let clusters = this.getAllClusters()
    clusters = clusters.filter(c => c.id !== clusterId)
    localStorage.setItem(CLUSTER_STORAGE_KEY, JSON.stringify(clusters))
    
    // If we deleted the active cluster, clear the active cluster
    const activeId = localStorage.getItem(ACTIVE_CLUSTER_KEY)
    if (activeId === clusterId) {
      localStorage.removeItem(ACTIVE_CLUSTER_KEY)
    }
  }
}

// Default cluster configuration
export const defaultClusterConfig: Omit<ClusterConfig, 'id'> = {
  name: 'Local etcd',
  endpoint: 'http://localhost:2379',
  username: '',
  password: '',
  tls: false,
  dialTimeout: 5000
}