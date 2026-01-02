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
  value?: string
  children: TreeItem[]
  isLeaf: boolean
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
        child.value = kv.value
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
        value: node.value || ""
      })
    }
    node.children.forEach(traverse)
  }

  tree.forEach(traverse)
  return result
}
