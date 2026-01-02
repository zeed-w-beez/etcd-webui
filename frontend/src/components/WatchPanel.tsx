import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type WatchEvent } from '@/services/etcd'
import { useToast } from '@/hooks/use-toast'
import { Play, Pause, Trash2, Download } from 'lucide-react'

interface WatchPanelProps {
  isConnected: boolean
}

export function WatchPanel({ isConnected }: WatchPanelProps) {
  const [prefix, setPrefix] = useState('')
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [isWatching, setIsWatching] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const connectWebSocket = () => {
    if (!isConnected) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Not connected to etcd cluster',
      })
      return
    }

    if (wsRef.current) {
      wsRef.current.close()
    }

    // Get WebSocket URL from API URL
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin
    const wsUrl = apiUrl.replace('http', 'ws') + '/api/watch?prefix=' + encodeURIComponent(prefix)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsWatching(true)
      setIsPaused(false)
      toast({
        title: 'Success',
        description: 'Watch connection established',
      })
    }

    ws.onmessage = (event) => {
      if (isPaused) return
      
      try {
        const watchEvent: WatchEvent = JSON.parse(event.data)
        setEvents(prev => [watchEvent, ...prev]) // Add new events to the top
      } catch (error) {
        console.error('Failed to parse watch event:', error)
      }
    }

    ws.onerror = () => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Watch connection error',
      })
      setIsWatching(false)
    }

    ws.onclose = () => {
      setIsWatching(false)
      toast({
        title: 'Info',
        description: 'Watch connection closed',
      })
    }
  }

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsWatching(false)
  }

  const clearEvents = () => {
    setEvents([])
  }

  const saveEvents = () => {
    if (events.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No events to save',
      })
      return
    }

    const dataStr = JSON.stringify(events, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `etcd-watch-events-${new Date().toISOString()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: 'Success',
      description: `Saved ${events.length} events`,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Watch Events</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Watch Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Enter prefix to watch (e.g., /my/prefix)"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                disabled={isWatching}
              />
            </div>
            {!isWatching ? (
              <Button onClick={connectWebSocket} disabled={!isConnected}>
                <Play className="h-4 w-4 mr-1" />
                Start Watching
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsPaused(!isPaused)}
                >
                  {isPaused ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={clearEvents}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={saveEvents}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={disconnectWebSocket}
                >
                  Stop
                </Button>
              </div>
            )}
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2 text-sm">
            <div className={`h-2 w-2 rounded-full ${isWatching 
              ? isPaused ? 'bg-yellow-500' : 'bg-green-500' 
              : 'bg-gray-300'}`} />
            <span>
              {isWatching 
                ? isPaused ? 'Watching (Paused)' : 'Watching...' 
                : 'Not watching'}
            </span>
            {events.length > 0 && (
              <span className="text-gray-500">({events.length} events)</span>
            )}
          </div>

          {/* Events List */}
          <ScrollArea className="h-[400px] border rounded-lg p-3">
            {events.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {isWatching ? (
                  <p>Waiting for events...</p>
                ) : (
                  <p>Enter a prefix and start watching to see events</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((event, index) => (
                  <div 
                    key={index} 
                    className={`p-3 rounded-lg border ${event.type === 'PUT' 
                      ? 'border-green-300 bg-green-50' 
                      : 'border-red-300 bg-red-50'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${event.type === 'PUT' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'}`}>
                          {event.type}
                        </span>
                        <span className="font-medium text-sm">{event.key}</span>
                      </div>
                      <span className="text-xs text-gray-500">{event.time}</span>
                    </div>
                    <div className="text-xs text-gray-600 mb-2">
                      Revision: {event.revision}
                      {event.leaseID && <span className="ml-2">Lease ID: {event.leaseID}</span>}
                    </div>
                    {event.type === 'PUT' ? (
                      <div>
                        {event.oldValue && (
                          <div className="mb-2">
                            <div className="text-xs font-medium text-gray-700 mb-1">Old Value:</div>
                            <pre className="text-xs bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap break-all">
                              {event.oldValue}
                            </pre>
                          </div>
                        )}
                        <div>
                          <div className="text-xs font-medium text-gray-700 mb-1">New Value:</div>
                          <pre className="text-xs bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap break-all">
                            {event.newValue}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs font-medium text-gray-700 mb-1">Deleted Value:</div>
                        <pre className="text-xs bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap break-all">
                          {event.oldValue}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  )
}