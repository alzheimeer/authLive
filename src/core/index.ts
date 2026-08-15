/**
 * Core Module Index
 * 
 * Export core components (ports, container).
 * 
 * @module core
 */

// Ports (interfaces)
export * from './ports/index.js';

// Container (dependency injection)
export { 
  container, 
  adapters,
  initializeContainer, 
  shutdownContainer,
  type IContainer,
} from './container.js';
