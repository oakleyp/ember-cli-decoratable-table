import { get } from '@ember/object';
import ObjectProxy from '@ember/object/proxy';
import PromiseProxyMixin from '@ember/object/promise-proxy-mixin';
import Mixin from '@ember/object/mixin';

const ObjectPromiseProxy = ObjectProxy.extend(PromiseProxyMixin);

export default Mixin.create({
    init() {
        this._super(...arguments);
        this.setProperties({
            _pending_transforms: [] // Stores meta for all async data transformations that haven't finished yet
        });
    },

    /**
     * Returns either an array of proxied objects that have been decorated based on their display_transform function in the table_columns object,
     * or the original array if there are no columns to decorate.
     * 
     * @param {Array} table_content - An array of objects that have the keys described by table_columns
     * 
     * @returns {Array} - An array of object proxies
     */
    decorateTableFields(table_content) {
        const transform_cols = this.get('table_columns').filter(col => typeof col.display_transform === 'function') || [];

        const proxy_refs = table_content.map(item => { // Create a proxy object for all array items so that we're not changing the actual records
                return ObjectProxy.create(
                    Object.assign({
                        content: item,
                    }, this._createProxyContent(transform_cols, item))
                );
            });

        // createProxyContent has built a list of async transforms that have been started
        // go through each one and set the right key when each promise resolves
        this.get('_pending_transforms').forEach(transform_info => {
            this._queueTransform(proxy_refs.findBy('id', transform_info.item_id), transform_info.transform_promise, transform_info.transform_field);
        });
        
        this._pending_transforms.clear();

        return proxy_refs;
    },

    /**
     * Returns an object where column.display_transform has been applied to the column.field_name on the given item for each column
     * 
     * Sets _pending_transforms for all columns that have an async display_transform function
     * 
     * @param {Array} columns - An array of column objects, where each contains a display_transform function and field_name
     * @param {Object} item - the unproxied item having its fields transformed
     * 
     * @returns {Object}
     */
    _createProxyContent(columns, item) {
        return columns.reduce((changed_fields, curr_col) => {
            const transformed_val = curr_col.display_transform.call(this, get(item, curr_col.field_name), item); // Result of display_transform, this could either be an immediate value or promise

            if (typeof (transformed_val || {}).then === 'function') { // Transform function returned promise

                // Set the current proxy value as a PromiseProxy, so we can check the state of the transform promise from anywhere
                changed_fields[curr_col.field_name] = ObjectPromiseProxy.create({
                    promise: transformed_val
                });

                this.get('_pending_transforms').pushObject({
                    transform_promise: transformed_val,
                    transform_field: curr_col.field_name,
                    item_id: get(item, 'id'),
                });
            } else { // Transform function returned immediate value
                changed_fields[curr_col.field_name] = transformed_val;
            }

            return changed_fields;
        }, {});
    },

    /**
     * Sets the given field on proxy_ref to the result of the given promise when it resolves
     * 
     * @param {Object} proxy_ref - Reference to a proxied object in the array returned by decorateTableFields
     * @param {Object/Promise} promise - The promise returned by a column's display_transform
     * @param {String} field - The name of the field to set on the proxy ref 
     * 
     * @returns {Promise} 
     */
    _queueTransform(proxy_ref, promise, field) {
        return promise.then(transformed_val => {
            proxy_ref.set(field, transformed_val);
        });
    }
});
