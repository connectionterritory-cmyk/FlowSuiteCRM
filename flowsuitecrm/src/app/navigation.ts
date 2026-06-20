import type { ComponentType } from 'react'
import {
  IconBriefcase,
  IconCalendarCheck,
  IconCalendarClock,
  IconCustomers,
  IconDashboard,
  IconFinance,
  IconInsurance,
  IconLeads,
  IconNavigation,
  IconPipeline,
  IconProducts,
  IconPrograms,
  IconService,
  IconShieldCheck,
  IconTelecom,
  IconTraining,
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
  disabled?: boolean
  badgeLabelKey?: string
  businessUnit?: 'telecom' | 'seguros' | 'finanzas' | 'comisiones' | 'entrenamiento' | 'royal_prestige'
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
    key: 'inicio',
    labelKey: 'nav.inicio',
    icon: IconDashboard,
    children: [
      {
        key: 'hub',
        labelKey: 'nav.hub',
        path: '/hub',
        icon: IconDashboard,
      },
      {
        key: 'dashboard',
        labelKey: 'nav.dashboard',
        path: '/dashboard',
        icon: IconDashboard,
      },
      {
        key: 'hoy',
        labelKey: 'nav.hoy',
        path: '/hoy',
        icon: IconCalendarCheck,
      },
      {
        key: 'inbox',
        labelKey: 'nav.inbox',
        path: '/inbox',
        icon: IconWhatsapp,
      },
    ],
  },
  {
    key: 'crm',
    labelKey: 'nav.crm',
    icon: IconCustomers,
    children: [
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
        key: 'citas',
        labelKey: 'nav.citas',
        path: '/citas',
        icon: IconCalendarClock,
      },
      {
        key: 'campo',
        labelKey: 'nav.campo',
        path: '/campo',
        icon: IconNavigation,
      },
    ],
  },
  {
    key: 'royal-prestige',
    labelKey: 'nav.royalPrestige',
    icon: IconBriefcase,
    children: [
      {
        key: 'ventas',
        labelKey: 'nav.ventas',
        path: '/ventas',
        icon: IconSales,
        businessUnit: 'royal_prestige',
      },
      {
        key: 'catalogo-productos',
        labelKey: 'nav.catalogoProductos',
        path: '/catalogo',
        icon: IconProducts,
        businessUnit: 'royal_prestige',
      },
      {
        key: 'cartera',
        labelKey: 'nav.cartera',
        path: '/cartera',
        icon: IconWallet,
        businessUnit: 'royal_prestige',
      },
      {
        key: 'telemercadeo',
        labelKey: 'nav.telemercadeo',
        path: '/telemercadeo',
        icon: IconUsers,
        businessUnit: 'royal_prestige',
        children: [
          {
            key: 'telemercadeo-cartera',
            labelKey: 'nav.telemercadeoCartera',
            path: '/telemercadeo/cartera',
            icon: IconWallet,
          },
          {
            key: 'telemercadeo-gestiones',
            labelKey: 'nav.telemercadeoGestiones',
            path: '/telemercadeo/gestiones',
            icon: IconUsers,
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
        key: 'marketing-flow',
        labelKey: 'nav.marketingFlow',
        path: '/marketing-flow',
        icon: IconLeads,
        businessUnit: 'royal_prestige',
      },
      {
        key: 'programas',
        labelKey: 'nav.programas',
        icon: IconPrograms,
        children: [
          {
            key: 'programas-index',
            labelKey: 'nav.programas',
            path: '/programas',
            icon: IconPrograms,
          },
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
    ],
  },
  {
    key: 'telecom',
    labelKey: 'nav.telecom',
    icon: IconTelecom,
    children: [
      {
        key: 'telecom-placeholder',
        labelKey: 'nav.proximamente',
        path: '/hub/telecom',
        icon: IconTelecom,
        disabled: true,
        badgeLabelKey: 'nav.proximamente',
        businessUnit: 'telecom',
      },
    ],
  },
  {
    key: 'seguros',
    labelKey: 'nav.seguros',
    icon: IconInsurance,
    children: [
      {
        key: 'seguros-placeholder',
        labelKey: 'nav.requiereLicencia',
        path: '/hub/seguros',
        icon: IconInsurance,
        disabled: true,
        badgeLabelKey: 'nav.requiereLicencia',
        businessUnit: 'seguros',
      },
    ],
  },
  {
    key: 'finanzas',
    labelKey: 'nav.finanzas',
    icon: IconFinance,
    children: [
      {
        key: 'finanzas-placeholder',
        labelKey: 'nav.proximamente',
        path: '/hub/finanzas',
        icon: IconFinance,
        disabled: true,
        badgeLabelKey: 'nav.proximamente',
        businessUnit: 'finanzas',
      },
    ],
  },
  {
    key: 'comisiones',
    labelKey: 'nav.comisiones',
    icon: IconBriefcase,
    children: [
      {
        key: 'comisiones-placeholder',
        labelKey: 'nav.proximamente',
        path: '/hub/comisiones',
        icon: IconBriefcase,
        disabled: true,
        badgeLabelKey: 'nav.proximamente',
        businessUnit: 'comisiones',
      },
    ],
  },
  {
    key: 'entrenamiento',
    labelKey: 'nav.entrenamiento',
    icon: IconTraining,
    children: [
      {
        key: 'entrenamiento-placeholder',
        labelKey: 'nav.proximamente',
        path: '/hub/entrenamiento',
        icon: IconTraining,
        disabled: true,
        badgeLabelKey: 'nav.proximamente',
        businessUnit: 'entrenamiento',
      },
    ],
  },
  {
    key: 'administracion',
    labelKey: 'nav.administracion',
    icon: IconShieldCheck,
    children: [
      {
        key: 'usuarios',
        labelKey: 'nav.usuarios',
        path: '/usuarios',
        icon: IconShieldCheck,
      },
      {
        key: 'importaciones',
        labelKey: 'nav.importaciones',
        path: '/importaciones',
        icon: IconProducts,
      },
      {
        key: 'servicio-cliente',
        labelKey: 'nav.servicioCliente',
        path: '/servicio-cliente',
        icon: IconService,
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
