import type { ComponentType } from 'react'
import {
  IconCalendarCheck,
  IconCalendarClock,
  IconCustomers,
  IconLeads,
  IconMoreHorizontal,
  IconNavigation,
  IconPipeline,
  IconProducts,
  IconPrograms,
  IconService,
  IconShieldCheck,
  IconUsers,
  IconSales,
  IconWhatsapp,
  IconWallet,
} from '../components/icons'

export type NavLeafItem = {
  key: string
  labelKey: string
  path: string
  icon: ComponentType<{ className?: string }>
  children?: NavItem[]
}

export type NavGroupItem = {
  key: string
  labelKey: string
  icon: ComponentType<{ className?: string }>
  children: NavItem[]
}

export type NavItem = NavLeafItem | NavGroupItem

export const isNavLeafItem = (item: NavItem): item is NavLeafItem =>
  'path' in item && typeof item.path === 'string'

export const isNavGroupItem = (item: NavItem): item is NavGroupItem =>
  !isNavLeafItem(item) && 'children' in item && Array.isArray(item.children)

export type NavSubItem = {
  key: string
  labelKey: string
  path: string
}

export const navItems: NavItem[] = [
  {
    key: 'hoy',
    labelKey: 'nav.hoy',
    path: '/hoy',
    icon: IconCalendarCheck,
  },
  {
    key: 'leads',
    labelKey: 'nav.leads',
    path: '/leads',
    icon: IconLeads,
  },
  {
    key: 'clientes',
    labelKey: 'nav.clientes',
    path: '/clientes',
    icon: IconCustomers,
  },
  {
    key: 'pipeline',
    labelKey: 'nav.pipeline',
    path: '/pipeline',
    icon: IconPipeline,
  },
  {
    key: 'cartera',
    labelKey: 'nav.cartera',
    path: '/cartera',
    icon: IconWallet,
  },
  {
    key: 'inbox',
    labelKey: 'nav.inbox',
    path: '/inbox',
    icon: IconWhatsapp,
  },
  {
    key: 'mas',
    labelKey: 'nav.mas',
    icon: IconMoreHorizontal,
    children: [
      {
        key: 'campo',
        labelKey: 'nav.campo',
        path: '/campo',
        icon: IconNavigation,
      },
      {
        key: 'citas',
        labelKey: 'nav.citas',
        path: '/citas',
        icon: IconCalendarClock,
      },
      {
        key: 'ventas',
        labelKey: 'nav.ventas',
        path: '/ventas',
        icon: IconSales,
      },
      {
        key: 'marketing-flow',
        labelKey: 'nav.marketingFlow',
        path: '/marketing-flow',
        icon: IconLeads,
      },
      {
        key: 'telemercadeo',
        labelKey: 'nav.telemercadeo',
        path: '/telemercadeo',
        icon: IconUsers,
        children: [
          {
            key: 'telemercadeo-gestiones',
            labelKey: 'nav.telemercadeoGestiones',
            path: '/telemercadeo/gestiones',
            icon: IconUsers,
          },
          {
            key: 'telemercadeo-cartera',
            labelKey: 'nav.telemercadeoCartera',
            path: '/telemercadeo/cartera',
            icon: IconWallet,
          },
          {
            key: 'telemercadeo-cumpleanos',
            labelKey: 'nav.telemercadeoCumpleanos',
            path: '/telemercadeo/cumpleanos',
            icon: IconCalendarCheck,
          },
          {
            key: 'telemercadeo-filtros',
            labelKey: 'nav.telemercadeoFiltros',
            path: '/telemercadeo/filtros',
            icon: IconProducts,
          },
          {
            key: 'telemercadeo-referidos',
            labelKey: 'nav.telemercadeoReferidos',
            path: '/telemercadeo/referidos',
            icon: IconCustomers,
          },
        ],
      },
      {
        key: 'productos',
        labelKey: 'nav.productos',
        path: '/productos',
        icon: IconProducts,
      },
      {
        key: 'catalogo-productos',
        labelKey: 'nav.catalogoProductos',
        path: '/catalogo',
        icon: IconProducts,
      },
      {
        key: 'programas',
        labelKey: 'nav.programas',
        path: '/programas',
        icon: IconPrograms,
        children: [
          {
            key: 'programa4en14',
            labelKey: 'nav.programa4en14',
            path: '/4en14',
            icon: IconCalendarCheck,
          },
          {
            key: 'conexiones-infinitas',
            labelKey: 'nav.conexionesInfinitas',
            path: '/conexiones-infinitas',
            icon: IconPrograms,
          },
        ],
      },
      {
        key: 'servicio-cliente',
        labelKey: 'nav.servicioCliente',
        path: '/servicio-cliente',
        icon: IconService,
      },
      {
        key: 'importaciones',
        labelKey: 'nav.importaciones',
        path: '/importaciones',
        icon: IconProducts,
      },
      {
        key: 'usuarios',
        labelKey: 'nav.usuarios',
        path: '/usuarios',
        icon: IconShieldCheck,
      },
    ],
  },
]

export const programSubItems: NavSubItem[] = [
  {
    key: 'programa4en14',
    labelKey: 'nav.programa4en14',
    path: '/4en14',
  },
  {
    key: 'conexiones-infinitas',
    labelKey: 'nav.conexionesInfinitas',
    path: '/conexiones-infinitas',
  },
]

export const telemercadeoSubItems: NavSubItem[] = [
  {
    key: 'telemercadeo-gestiones',
    labelKey: 'nav.telemercadeoGestiones',
    path: '/telemercadeo/gestiones',
  },
  {
    key: 'telemercadeo-cartera',
    labelKey: 'nav.telemercadeoCartera',
    path: '/telemercadeo/cartera',
  },
  {
    key: 'telemercadeo-cumpleanos',
    labelKey: 'nav.telemercadeoCumpleanos',
    path: '/telemercadeo/cumpleanos',
  },
  {
    key: 'telemercadeo-filtros',
    labelKey: 'nav.telemercadeoFiltros',
    path: '/telemercadeo/filtros',
  },
  {
    key: 'telemercadeo-referidos',
    labelKey: 'nav.telemercadeoReferidos',
    path: '/telemercadeo/referidos',
  },
]

export function flattenNavItems(items: NavItem[]): NavLeafItem[] {
  return items.flatMap((item) => {
    if (isNavLeafItem(item)) {
      return [item, ...(item.children ? flattenNavItems(item.children) : [])]
    }
    if (isNavGroupItem(item)) {
      return flattenNavItems(item.children)
    }
    return []
  })
}

export const allNavigationItems = flattenNavItems(navItems)
