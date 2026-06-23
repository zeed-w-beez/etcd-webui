import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { type EtcdKey } from "@/services/etcd"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface TreeItem {
  key: string
  name: string
  path: string
  children: TreeItem[]
  isLeaf: boolean
  loaded?: boolean
}

export interface KeyChild {
  name: string
  path: string
  isLeaf: boolean
}

export function childrenToTreeItems(children: KeyChild[]): TreeItem[] {
  return children
    .map((child) => ({
      key: child.path,
      name: child.name,
      path: child.path,
      children: [],
      isLeaf: child.isLeaf,
      loaded: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function updateTreeChildren(tree: TreeItem[], path: string, children: TreeItem[]): TreeItem[] {
  return tree.map((node) => {
    if (node.path === path) {
      return { ...node, children, loaded: true }
    }
    if (node.children.length > 0) {
      return { ...node, children: updateTreeChildren(node.children, path, children) }
    }
    return node
  })
}

export function keysToTree(keys: EtcdKey[]): TreeItem[] {
  const root: TreeItem = {
    key: "root",
    name: "root",
    path: "",
    children: [],
    isLeaf: false
  }

  keys.forEach(kv => {
    const parts = kv.key.split("/")
    let current = root

    parts.forEach((part, index) => {
      if (!part) return

      const path = parts.slice(0, index + 1).join("/")
      let child = current.children.find(c => c.name === part)

      if (!child) {
        child = {
          key: path,
          name: part,
          path,
          children: [],
          isLeaf: index === parts.length - 1
        }
        current.children.push(child)
      }

      if (index === parts.length - 1) {
        child.isLeaf = true
      }

      current = child
    })
  })

  return root.children
}

export function flattenTree(tree: TreeItem[]): EtcdKey[] {
  const result: EtcdKey[] = []

  function traverse(node: TreeItem) {
    if (node.isLeaf) {
      result.push({
        key: node.key,
        value: "",
      })
    }
    node.children.forEach(traverse)
  }

  tree.forEach(traverse)
  return result
}
