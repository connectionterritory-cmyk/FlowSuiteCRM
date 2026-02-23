import type { ComponentType } from 'react'
import {
  IconCustomers,
  IconDashboard,
  IconLeads,
  IconPipeline,
  IconProducts,
  IconPrograms,
  IconService,
  IconUsers,
  IconSales,
} from '../components/icons'

export type NavItem = {
  key: string
  labelKey: string
  path: string
  icon: ComponentType<{ className?: string }>
}

export type NavSubItem = {
  key: string
  labelKey: string
  path: string
}

export const navItems: NavItem[] = [
  {
    key: 'dashboard',
    labelKey: 'nav.dashboard',
    path: '/dashboard',
    icon: IconDashboard,
  },
  {
    key: 'pipeline',
    labelKey: 'nav.oportunidades',
    path: '/pipeline',
    icon: IconPipeline,
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
    key: 'ventas',
    labelKey: 'nav.ventas',
    path: '/ventas',
    icon: IconSales,
  },
  {
    key: 'productos',
    labelKey: 'nav.productos',
    path: '/productos',
    icon: IconProducts,
  },
  {
    key: 'programas',
    labelKey: 'nav.programas',
    path: '/programas',
    icon: IconPrograms,
  },
  {
    key: 'servicio-cliente',
    labelKey: 'nav.servicioCliente',
    path: '/servicio-cliente',
    icon: IconService,
  },
  {
    key: 'telemercadeo',
    labelKey: 'nav.telemercadeo',
    path: '/telemercadeo',
    icon: IconUsers,
  },
  {
    key: 'importaciones',
    labelKey: 'nav.importaciones',
    path: '/importaciones',
    icon: IconUsers,
  },
  {
    key: 'usuarios',
    labelKey: 'nav.usuarios',
    path: '/usuarios',
    icon: IconUsers,
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
