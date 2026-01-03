import { describe, it, expect, vi, beforeEach } from 'vitest'
import { etcdApi, type EtcdKey } from '@/services/etcd'

describe('etcdApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('getKeys', () => {
    it('should fetch keys without prefix', async () => {
      const mockKeys: EtcdKey[] = [
        { key: '/test/key1', value: 'value1' },
        { key: '/test/key2', value: 'value2' },
      ]

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ keys: mockKeys, count: 2 }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      const result = await etcdApi.getKeys()

      expect(fetchMock).toHaveBeenCalledWith('/api/keys')
      expect(result).toEqual(mockKeys)
    })

    it('should include prefix parameter when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ keys: [], count: 0 }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.getKeys('/test')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?prefix=%2Ftest')
    })

    it('should include limit parameter when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ keys: [], count: 0 }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.getKeys(undefined, 50)

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?limit=50')
    })
  })

  describe('getKey', () => {
    it('should encode key with special characters', async () => {
      const mockKey: EtcdKey = {
        key: '/test/key',
        value: 'test value'
      }

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockKey),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.getKey('/test/key')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?key=%2Ftest%2Fkey')
    })
  })

  describe('createKey', () => {
    it('should create key successfully', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.createKey('/test/key', 'test value')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: '/test/key', value: 'test value' }),
      })
    })

    it('should throw error when response is not ok', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ error: 'Key already exists' }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await expect(etcdApi.createKey('/test/key', 'value'))
        .rejects.toThrow('Failed to create key')
    })
  })

  describe('updateKey', () => {
    it('should update key with encoded key in query parameter', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.updateKey('/test/key', 'updated value')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?key=%2Ftest%2Fkey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'updated value' }),
      })
    })

    it('should handle key with multiple slashes', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.updateKey('/a/b/c/d/key', 'value')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?key=%2Fa%2Fb%2Fc%2Fd%2Fkey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'value' }),
      })
    })

    it('should throw error when key not found', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ error: 'key not found' }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await expect(etcdApi.updateKey('/nonexistent', 'value'))
        .rejects.toThrow('Failed to update key')
    })
  })

  describe('deleteKey', () => {
    it('should delete key with encoded key in query parameter', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.deleteKey('/test/key')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?key=%2Ftest%2Fkey', {
        method: 'DELETE',
      })
    })

    it('should handle key with special characters', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.deleteKey('/test/key with spaces')

      expect(fetchMock).toHaveBeenCalledWith('/api/keys?key=%2Ftest%2Fkey%20with%20spaces', {
        method: 'DELETE',
      })
    })

    it('should throw error when delete fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ error: 'internal server error' }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await expect(etcdApi.deleteKey('/test/key'))
        .rejects.toThrow('Failed to delete key')
    })
  })

  describe('deleteKeys', () => {
    it('should delete multiple keys', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      await etcdApi.deleteKeys(['/key1', '/key2'])

      expect(fetchMock).toHaveBeenCalledWith('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: ['/key1', '/key2'] }),
      })
    })
  })

  describe('checkHealth', () => {
    it('should return healthy status', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy', etcd: '3.5.0' }),
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      const result = await etcdApi.checkHealth()

      expect(result.status).toBe('healthy')
    })

    it('should return unhealthy status on error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      })
      vi.spyOn(window, 'fetch').mockImplementation(fetchMock)

      const result = await etcdApi.checkHealth()

      expect(result.status).toBe('unhealthy')
    })
  })

  describe('URL encoding edge cases', () => {
    it('should correctly encode keys with slashes', () => {
      const key = '/namespace/config/database'
      const encoded = encodeURIComponent(key)
      expect(encoded).toBe('%2Fnamespace%2Fconfig%2Fdatabase')
    })

    it('should correctly encode keys with spaces', () => {
      const key = '/test/key with spaces'
      const encoded = encodeURIComponent(key)
      expect(encoded).toBe('%2Ftest%2Fkey%20with%20spaces')
    })

    it('should correctly encode keys with special characters', () => {
      const key = '/test/key?query=value'
      const encoded = encodeURIComponent(key)
      expect(encoded).toBe('%2Ftest%2Fkey%3Fquery%3Dvalue')
    })
  })
})
