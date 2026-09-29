# Phase-1 验收样本

本目录包含用于验证第一阶段功能的测试数据。每个样本都记录了预期特征、坐标参考系统 (CRS)、已知异常和来源/许可信息。

## 矢量数据样本

### 1. points.geojson

- **类型**: GeoJSON Point
- **特征数量**: 3
- **CRS**: EPSG:4326 (WGS84)
- **属性字段**: `id`, `name`, `type`, `value`
- **预期异常**: 无
- **来源**: 手工构造用于测试
- **许可**: Public Domain

### 2. lines.geojson

- **类型**: GeoJSON LineString
- **特征数量**: 2
- **CRS**: EPSG:4326 (WGS84)
- **属性字段**: `id`, `name`, `length`
- **预期异常**: 无
- **来源**: 手工构造用于测试
- **许可**: Public Domain

### 3. polygons.geojson

- **类型**: GeoJSON Polygon
- **特征数量**: 2
- **CRS**: EPSG:4326 (WGS84)
- **属性字段**: `id`, `name`, `area`, `category`
- **预期异常**: 无
- **来源**: 手工构造用于测试
- **许可**: Public Domain

### 4. features-with-issues.geojson

- **类型**: GeoJSON FeatureCollection (混合几何)
- **特征数量**: 5
- **CRS**: EPSG:4326 (WGS84)
- **属性字段**: `id`, `name`, `notes`
- **预期异常**:
  - 包含重复 ID (id: "duplicate-1" 出现两次)
  - 一个特征缺失 `name` 属性
  - 一个特征的 `notes` 为空字符串
  - 一个特征的 `name` 为 null
- **来源**: 手工构造用于测试边界情况
- **许可**: Public Domain

### 5. chinese-fields.zip

- **类型**: Shapefile (打包为 ZIP)
- **文件内容**: chinese-fields.shp, .shx, .dbf, .prj
- **特征数量**: 3
- **CRS**: EPSG:4326 (WGS84)
- **属性字段**: `编号`, `名称`, `类型`
- **预期异常**: 无 (测试中文字段名和值的正确编码)
- **来源**: 手工构造用于测试中文编码
- **许可**: Public Domain
- **注意**: 当前为简化实现,可能使用最小的 Shapefile 结构

### 6. coordinates-with-errors.csv

- **类型**: CSV 坐标点数据
- **记录总数**: 6
- **有效记录数**: 4
- **CRS**: EPSG:4326 (WGS84)
- **字段**: `id`, `name`, `longitude`, `latitude`, `notes`
- **预期异常**:
  - 第 3 行: 纬度值超出有效范围 (91)
  - 第 5 行: 经度为非数字值 ("invalid")
  - 包含带引号字段和字段内换行符
  - 包含前导零的 ID 字段 (应保留)
- **来源**: 手工构造用于测试 CSV 解析容错
- **许可**: Public Domain

### 7. basic-entities.dxf

- **类型**: ASCII DXF (2D)
- **实体数量**: 5 (POINT, LINE, LWPOLYLINE, CIRCLE, ARC)
- **CRS**: 假定为本地坐标系统,无投影信息
- **单位**: 未明确定义 (通常视为米或用户单位)
- **图层**: Layer0, Geometry, Annotations
- **预期异常**: 无
- **来源**: 手工构造的最小二维 DXF
- **许可**: Public Domain
- **注意**: 仅包含基础实体,不包含 BLOCK、SPLINE、HATCH 等高级特性

## 服务响应样本

这些样本文件位于对应 package 的测试 fixtures 中,此处提供索引:

### WMS Capabilities

- **1.3.0 版本**: `packages/*/fixtures/wms-1.3.0-capabilities.xml`
- **1.1.1 版本**: `packages/*/fixtures/wms-1.1.1-capabilities.xml`
- **错误响应**: `packages/*/fixtures/wms-service-exception.xml`
- **非 XML 响应**: `packages/*/fixtures/wms-invalid-response.txt`

### WMTS Capabilities

- **标准响应**: `packages/*/fixtures/wmts-capabilities.xml`
- **REST 模板**: 在 capabilities 中定义
- **KVP 请求**: 在 capabilities 中定义

### WFS Capabilities

- **2.0.0 版本**: `packages/*/fixtures/wfs-2.0.0-capabilities.xml`
- **1.1.0 版本**: `packages/*/fixtures/wfs-1.1.0-capabilities.xml`
- **异常响应**: `packages/*/fixtures/wfs-exception.xml`

## 使用说明

1. 本目录中的文件主要用于手动测试和验收
2. 单元测试应优先使用各 package 内的 fixtures
3. 所有样本数据均为最小化构造,用于验证特定功能点
4. 如需真实地理数据测试,应使用公开可用的开放数据集

## 维护说明

- 修改样本时应同步更新本 README
- 新增样本应明确记录预期特征和异常
- 保持样本文件小型化,便于版本控制和快速测试

## OGC Capabilities fixtures (P15)

See [ogc/](./ogc/) for WMS 1.3.0 / 1.1.1, WMTS 1.0.0, and WFS 2.0.0 Capabilities XML samples (no credentials). Canonical test copies live in `packages/ogc-io/fixtures/`.
